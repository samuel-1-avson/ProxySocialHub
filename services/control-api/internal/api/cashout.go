package api

// Cash out to Mobile Money for managed-wallet providers (Google sign-in).
//
//	provider wallet (SOL) --server signs--> platform float --Paystack Transfer--> MoMo (GH₵)
//
//	quoted -> confirmed -> sweeping -> swept -> transferring -> completed
//	                                         transfer failed -> refunding -> refunded
//
// Money safety:
//   - The sweep is signed here, so its signature is stored before it is sent; a
//     retry checks that exact transaction and never sweeps twice.
//   - The cash-out reference is also the Paystack transfer reference; Paystack
//     refuses a reused reference, so a retry cannot pay twice.
//   - A refund is marked started before it is sent; a refund that started but never
//     recorded a tx is left for ops rather than retried.
//
// Providers only: buyers' managed SOL comes from card payments, and letting it out
// to MoMo would make this a card-to-MoMo money service.

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/config"
	"github.com/proxyhubb/control-api/internal/custody"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/paystack"
	"github.com/proxyhubb/control-api/internal/solana"
	"gorm.io/gorm"
)

const (
	cashoutQuoteTTL        = 5 * time.Minute
	cashoutDestCooldown    = 24 * time.Hour
	cashoutSweepDropAfter  = 90 * time.Second // blockhash lifetime; an unseen sweep after this never lands
	cashoutTxFeeLamports   = uint64(5_000)
	cashoutInlineWait      = 75 * time.Second
	cashoutRequestDeadline = 150 * time.Second
)

var errCashoutNotReady = errors.New("cash-out still in progress")

// Seams for tests.
var (
	cashoutCreateRecipient = paystack.CreateMoMoRecipient
	cashoutTransfer        = paystack.Transfer
	cashoutVerifyTransfer  = paystack.VerifyTransfer
	cashoutEncryptPhone    = func(phone string) (string, error) {
		if models.CredentialEncryptFn == nil {
			return "", errors.New("credential encryption is not configured")
		}
		return models.CredentialEncryptFn(phone)
	}
	cashoutFloatAddress = func() (sol.PublicKey, error) {
		oracle := solana.GetOracle()
		if oracle == nil {
			return sol.PublicKey{}, errors.New("solana oracle not configured")
		}
		return oracle.GetPayoutPublicKey(), nil
	}
	// cashoutSignSweep builds and signs the managed wallet -> float transfer without
	// sending it, so the signature can be recorded first.
	cashoutSignSweep = func(ctx context.Context, signer *custody.Signer, from, to sol.PublicKey, lamports uint64) (*sol.Transaction, error) {
		oracle := solana.GetOracle()
		if oracle == nil {
			return nil, errors.New("solana oracle not configured")
		}
		ix, err := solana.BuildSOLTransferIx(from, to, lamports)
		if err != nil {
			return nil, err
		}
		blockhash, err := oracle.LatestBlockhash(ctx)
		if err != nil {
			return nil, err
		}
		tx, err := sol.NewTransaction([]sol.Instruction{ix}, blockhash, sol.TransactionPayer(from))
		if err != nil {
			return nil, err
		}
		if err := signer.SignTransaction(tx); err != nil {
			return nil, err
		}
		return tx, nil
	}
	cashoutSendSigned = func(ctx context.Context, tx *sol.Transaction) error {
		oracle := solana.GetOracle()
		if oracle == nil {
			return errors.New("solana oracle not configured")
		}
		_, err := oracle.SendSignedTransaction(ctx, tx)
		return err
	}
	cashoutSigStatus = func(ctx context.Context, sig string) (bool, bool, error) {
		oracle := solana.GetOracle()
		if oracle == nil {
			return false, false, errors.New("solana oracle not configured")
		}
		return oracle.SignatureStatus(ctx, sig)
	}
	// cashoutRefund sends SOL from the float back to the managed wallet (velocity-guarded).
	cashoutRefund = func(ctx context.Context, to sol.PublicKey, lamports uint64) (string, error) {
		return fiatTreasurySend(ctx, to, lamports)
	}
	cashoutGoogleClientID = func() string {
		if cfg, err := config.Load(); err == nil {
			return strings.TrimSpace(cfg.OAuth.GoogleClientID)
		}
		return strings.TrimSpace(os.Getenv("GOOGLE_CLIENT_ID"))
	}
)

// RegisterCashoutRoutes mounts the cash-out routes on the authenticated group.
func RegisterCashoutRoutes(rg *gin.RouterGroup) {
	rg.GET("/wallet/cashout", getCashoutOverview)
	rg.POST("/wallet/cashout/destination", StrictRateLimit(), setCashoutDestination)
	rg.POST("/wallet/cashout/quote", StrictRateLimit(), quoteCashout)
	rg.POST("/wallet/cashout/:id/confirm", StrictRateLimit(), confirmCashout)
	rg.GET("/wallet/cashout/:id", getCashout)
}

func cashoutEnabled() bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("CASHOUT_ENABLED")))
	return (v == "true" || v == "1") && paystack.Configured()
}

type cashoutLimits struct {
	MinGHS      float64 `json:"min_ghs"`
	MaxGHS      float64 `json:"max_ghs"`
	DailyGHS    float64 `json:"daily_ghs"`
	FlatFeeGHS  float64 `json:"flat_fee_ghs"`
	BufferPct   float64 `json:"buffer_pct"`
	UsedTodayGH float64 `json:"used_today_ghs"`
}

func loadCashoutLimits(userID uuid.UUID) cashoutLimits {
	var used int64
	db.DB.Model(&models.Cashout{}).
		Where("user_id = ? AND status NOT IN ? AND created_at > ?", userID,
			[]models.CashoutStatus{models.CashoutQuoted, models.CashoutExpired, models.CashoutRefunded, models.CashoutFailed},
			time.Now().Add(-24*time.Hour)).
		Select("COALESCE(SUM(amount_minor), 0)").Scan(&used)
	return cashoutLimits{
		MinGHS:      envFloat("CASHOUT_MIN_GHS", 5),
		MaxGHS:      envFloat("CASHOUT_MAX_GHS", 2000),
		DailyGHS:    envFloat("CASHOUT_DAILY_LIMIT_GHS", 5000),
		FlatFeeGHS:  envFloat("CASHOUT_FLAT_FEE_GHS", 1),
		BufferPct:   envFloat("CASHOUT_FEE_BUFFER_PCT", 3),
		UsedTodayGH: float64(used) / 100,
	}
}

// cashoutProvider loads the caller and checks they are a managed-wallet provider.
func cashoutProvider(c *gin.Context) (*models.User, *managedBuyer, bool) {
	if !cashoutEnabled() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Cash out to Mobile Money is not enabled", "code": "cashout_disabled"})
		return nil, nil, false
	}
	userID, err := parseAuthenticatedUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user ID"})
		return nil, nil, false
	}
	var user models.User
	if err := db.DB.First(&user, "id = ?", userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return nil, nil, false
	}
	if !roleHasProviderAccess(user.Role) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Cash out is for providers' earnings", "code": "provider_only"})
		return nil, nil, false
	}
	buyer, err := loadManagedBuyer(userID)
	if err != nil {
		respondManagedBuyerError(c, err)
		return nil, nil, false
	}
	return &user, buyer, true
}

// cashoutSpendable is what can leave the wallet: the balance minus the rent-exempt
// floor and one transaction fee.
func cashoutSpendable(ctx context.Context, addr sol.PublicKey) (uint64, error) {
	bal, err := fiatWalletBalance(ctx, addr)
	if err != nil {
		return 0, err
	}
	reserve := rentExemptMinLamports + cashoutTxFeeLamports
	if bal <= reserve {
		return 0, nil
	}
	return bal - reserve, nil
}

func cashoutRates(ctx context.Context) (solUSD, usdGHS float64, err error) {
	solUSD, err = fiatSOLPriceUSD(ctx)
	if err != nil || solUSD <= 0 {
		return 0, 0, errors.New("SOL price unavailable")
	}
	usdGHS, err = fiatUSDToGHS(ctx)
	if err != nil {
		return 0, 0, err
	}
	return solUSD, usdGHS, nil
}

func getCashoutOverview(c *gin.Context) {
	user, buyer, ok := cashoutProvider(c)
	if !ok {
		return
	}
	ctx := c.Request.Context()
	resp := gin.H{"limits": loadCashoutLimits(user.ID)}

	var dest models.PayoutDestination
	if err := db.DB.Where("user_id = ?", user.ID).First(&dest).Error; err == nil {
		resp["destination"] = gin.H{
			"network":     dest.Network,
			"phone_last4": dest.PhoneLast4,
			"name":        dest.AccountName,
			"ready_at":    destinationReadyAt(&dest),
		}
	}
	if spendable, err := cashoutSpendable(ctx, buyer.address); err == nil {
		resp["spendable_sol"] = models.LamportsToSOL(spendable)
		if solUSD, usdGHS, err := cashoutRates(ctx); err == nil {
			resp["spendable_ghs_estimate"] = math.Floor(models.LamportsToSOL(spendable)*solUSD*usdGHS*100) / 100
		}
	}
	var recent []models.Cashout
	db.DB.Where("user_id = ? AND status <> ?", user.ID, models.CashoutQuoted).Order("created_at DESC").Limit(10).Find(&recent)
	resp["recent"] = recent
	c.JSON(http.StatusOK, resp)
}

// destinationReadyAt is when a changed destination can be used (24h after a change;
// a first destination is usable at once).
func destinationReadyAt(d *models.PayoutDestination) time.Time {
	if d.UpdatedAt.Sub(d.CreatedAt) > time.Second {
		return d.UpdatedAt.Add(cashoutDestCooldown)
	}
	return d.CreatedAt
}

var ghanaPhone = regexp.MustCompile(`^0[235]\d{8}$`)

// normalizeGhanaPhone accepts 0XXXXXXXXX, 233XXXXXXXXX or +233XXXXXXXXX.
func normalizeGhanaPhone(raw string) (string, bool) {
	p := strings.NewReplacer(" ", "", "-", "", "(", "", ")", "").Replace(strings.TrimSpace(raw))
	p = strings.TrimPrefix(p, "+")
	if strings.HasPrefix(p, "233") && len(p) == 12 {
		p = "0" + p[3:]
	}
	return p, ghanaPhone.MatchString(p)
}

type cashoutDestinationRequest struct {
	Network     string `json:"network" binding:"required"`
	Phone       string `json:"phone" binding:"required"`
	AccountName string `json:"account_name" binding:"required"`
}

func setCashoutDestination(c *gin.Context) {
	user, _, ok := cashoutProvider(c)
	if !ok {
		return
	}
	var req cashoutDestinationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "network, phone and account_name are required"})
		return
	}
	network := strings.ToUpper(strings.TrimSpace(req.Network))
	if !paystack.ValidMoMoNetwork(network) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Choose MTN, Telecel or AirtelTigo"})
		return
	}
	phone, valid := normalizeGhanaPhone(req.Phone)
	if !valid {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Enter a Ghana mobile number, e.g. 0241234567"})
		return
	}
	name := strings.TrimSpace(req.AccountName)
	if len(name) < 2 || len(name) > 100 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Enter the name on the Mobile Money account"})
		return
	}
	var open int64
	db.DB.Model(&models.Cashout{}).Where("user_id = ? AND status IN ?", user.ID, models.CashoutOpenStatuses).Count(&open)
	if open > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "Wait for your current cash-out to finish before changing where you get paid"})
		return
	}

	recipient, err := cashoutCreateRecipient(c.Request.Context(), name, phone, network)
	if err != nil {
		logging.Warn().Err(err).Str("user_id", user.ID.String()).Msg("cashout: create recipient failed")
		c.JSON(http.StatusBadGateway, gin.H{"error": "Paystack could not register this number. Check it and try again."})
		return
	}
	enc, err := cashoutEncryptPhone(phone)
	if err != nil {
		logging.Error(err).Msg("cashout: encrypt phone")
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Cash out is temporarily unavailable"})
		return
	}

	now := time.Now().UTC()
	var dest models.PayoutDestination
	err = db.DB.Where("user_id = ?", user.ID).First(&dest).Error
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		dest = models.PayoutDestination{
			ID: uuid.New(), UserID: user.ID, Type: "mobile_money", Network: network,
			PhoneEnc: enc, PhoneLast4: phone[len(phone)-4:], AccountName: name, RecipientCode: recipient,
			CreatedAt: now, UpdatedAt: now,
		}
		err = db.DB.Create(&dest).Error
	case err == nil:
		err = db.DB.Model(&dest).Updates(map[string]any{
			"network": network, "phone_enc": enc, "phone_last4": phone[len(phone)-4:],
			"account_name": name, "recipient_code": recipient, "updated_at": now,
		}).Error
		dest.UpdatedAt = now
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not save your Mobile Money number"})
		return
	}
	RecordAuditLog(c, models.AuditWalletWithdraw, models.AuditSeverityWarning, &user.ID, "payout_destination", dest.ID.String(),
		"Mobile Money payout destination set ("+network+" …"+dest.PhoneLast4+")", true)
	c.JSON(http.StatusOK, gin.H{
		"network": dest.Network, "phone_last4": dest.PhoneLast4, "name": dest.AccountName,
		"ready_at": destinationReadyAt(&dest),
	})
}

type cashoutQuoteRequest struct {
	AmountGHS float64 `json:"amount_ghs" binding:"required"`
}

func quoteCashout(c *gin.Context) {
	user, buyer, ok := cashoutProvider(c)
	if !ok {
		return
	}
	var req cashoutQuoteRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.AmountGHS <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Enter an amount in GH₵"})
		return
	}
	ctx := c.Request.Context()
	limits := loadCashoutLimits(user.ID)
	amountMinor := int64(math.Round(req.AmountGHS * 100))
	switch {
	case float64(amountMinor) < limits.MinGHS*100:
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("The minimum cash-out is GH₵%.0f", limits.MinGHS), "code": "below_min"})
		return
	case float64(amountMinor) > limits.MaxGHS*100:
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("The maximum cash-out is GH₵%.0f", limits.MaxGHS), "code": "above_max"})
		return
	case float64(amountMinor)/100+limits.UsedTodayGH > limits.DailyGHS:
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("You've reached today's cash-out limit of GH₵%.0f", limits.DailyGHS), "code": "daily_limit"})
		return
	}

	var dest models.PayoutDestination
	if err := db.DB.Where("user_id = ?", user.ID).First(&dest).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Add your Mobile Money number first", "code": "no_destination"})
		return
	}
	if ready := destinationReadyAt(&dest); time.Now().Before(ready) {
		c.JSON(http.StatusForbidden, gin.H{"error": "For your safety, a new Mobile Money number can receive cash-outs 24 hours after it was added", "code": "destination_cooldown", "ready_at": ready})
		return
	}
	var flags int64
	db.DB.Model(&models.UserFlag{}).Where("user_id = ? AND resolved = ?", user.ID, false).Count(&flags)
	if flags > 0 {
		c.JSON(http.StatusForbidden, gin.H{"error": "Your account is under security review. Cash-outs are paused.", "code": "account_flagged"})
		return
	}
	var inFlight int64
	db.DB.Model(&models.FiatPayment{}).Where("user_id = ? AND status IN ?", user.ID,
		[]models.FiatPaymentStatus{models.FiatPaymentPaid, models.FiatPaymentFunded, models.FiatPaymentEscrowed}).Count(&inFlight)
	var open int64
	db.DB.Model(&models.Cashout{}).Where("user_id = ? AND status IN ?", user.ID, models.CashoutOpenStatuses).Count(&open)
	if inFlight > 0 || open > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "Another payment on your wallet is still finishing. Try again in a minute.", "code": "busy"})
		return
	}

	solUSD, usdGHS, err := cashoutRates(ctx)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Exchange rate unavailable. Try again shortly."})
		return
	}
	feeMinor := int64(math.Round(limits.FlatFeeGHS * 100))
	grossGHS := float64(amountMinor+feeMinor) / 100
	lamports := uint64(math.Ceil(grossGHS / (solUSD * usdGHS) * (1 + limits.BufferPct/100) * 1e9))
	spendable, err := cashoutSpendable(ctx, buyer.address)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Could not read your wallet balance. Try again shortly."})
		return
	}
	if lamports > spendable {
		c.JSON(http.StatusPaymentRequired, gin.H{
			"error":                  "Not enough earnings for this amount",
			"code":                   "insufficient_balance",
			"spendable_ghs_estimate": math.Floor(models.LamportsToSOL(spendable)*solUSD*usdGHS/(1+limits.BufferPct/100)*100)/100 - limits.FlatFeeGHS,
		})
		return
	}

	row := models.Cashout{
		ID: uuid.New(), UserID: user.ID, DestinationID: dest.ID,
		Reference: "phco_" + strings.ReplaceAll(uuid.NewString(), "-", ""),
		Lamports:  int64(lamports), AmountMinor: amountMinor, FeeMinor: feeMinor, Currency: "GHS",
		SOLPriceUSD: solUSD, USDGHSRate: usdGHS, Status: models.CashoutQuoted,
	}
	if err := db.DB.Create(&row).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not create the quote"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"id":          row.ID,
		"amount_ghs":  float64(row.AmountMinor) / 100,
		"fee_ghs":     float64(row.FeeMinor) / 100,
		"sol":         models.LamportsToSOL(lamports),
		"network":     dest.Network,
		"phone_last4": dest.PhoneLast4,
		"expires_in":  int(cashoutQuoteTTL.Seconds()),
	})
}

type cashoutConfirmRequest struct {
	GoogleCredential string `json:"google_credential" binding:"required"`
}

// confirmCashout requires a fresh Google sign-in (step-up) from the same Google
// account, then starts the cash-out.
func confirmCashout(c *gin.Context) {
	user, _, ok := cashoutProvider(c)
	if !ok {
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid cash-out ID"})
		return
	}
	var req cashoutConfirmRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Confirm with Google to continue"})
		return
	}
	var row models.Cashout
	if err := db.DB.Where("id = ? AND user_id = ?", id, user.ID).First(&row).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Cash-out not found"})
		return
	}
	if row.Status != models.CashoutQuoted {
		c.JSON(http.StatusConflict, gin.H{"error": "This cash-out was already started", "status": row.Status})
		return
	}
	if time.Since(row.CreatedAt) > cashoutQuoteTTL {
		_ = setCashoutStatus(&row, models.CashoutExpired, nil)
		c.JSON(http.StatusGone, gin.H{"error": "This quote expired. Get a new one.", "code": "quote_expired"})
		return
	}

	clientID := cashoutGoogleClientID()
	if clientID == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Google confirmation is not configured"})
		return
	}
	identity, err := verifyGoogleToken(c.Request.Context(), req.GoogleCredential, clientID)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Google confirmation failed. Try again.", "code": "step_up_failed"})
		return
	}
	var ident models.UserIdentity
	if err := db.DB.Where("provider = ? AND subject = ? AND user_id = ?", models.IdentityProviderGoogle, identity.Subject, user.ID).
		First(&ident).Error; err != nil {
		RecordAuditLog(c, models.AuditWalletWithdraw, models.AuditSeverityWarning, &user.ID, "cashout", row.ID.String(),
			"Cash-out step-up used a different Google account", false)
		c.JSON(http.StatusForbidden, gin.H{"error": "Confirm with the Google account you signed up with", "code": "step_up_mismatch"})
		return
	}

	if err := setCashoutStatus(&row, models.CashoutConfirmed, nil); err != nil {
		// uq_cashouts_user_open: another cash-out is already running.
		c.JSON(http.StatusConflict, gin.H{"error": "Another cash-out is still finishing", "code": "busy"})
		return
	}
	RecordAuditLog(c, models.AuditWalletWithdraw, models.AuditSeverityInfo, &user.ID, "cashout", row.ID.String(),
		fmt.Sprintf("Cash-out confirmed: GH₵%.2f for %d lamports", float64(row.AmountMinor)/100, row.Lamports), true)

	ctx, cancel := context.WithTimeout(c.Request.Context(), cashoutRequestDeadline)
	defer cancel()
	p, err := processCashout(ctx, row.Reference)
	if p == nil {
		p = &row
	}
	c.JSON(http.StatusOK, cashoutResponse(p, err))
}

func getCashout(c *gin.Context) {
	user, _, ok := cashoutProvider(c)
	if !ok {
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid cash-out ID"})
		return
	}
	var row models.Cashout
	if err := db.DB.Where("id = ? AND user_id = ?", id, user.ID).First(&row).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Cash-out not found"})
		return
	}
	c.JSON(http.StatusOK, cashoutResponse(&row, nil))
}

func cashoutResponse(p *models.Cashout, err error) gin.H {
	resp := gin.H{"id": p.ID, "status": p.Status, "amount_ghs": float64(p.AmountMinor) / 100, "reference": p.Reference}
	switch p.Status {
	case models.CashoutCompleted:
		resp["message"] = "Sent to your Mobile Money"
	case models.CashoutRefunded:
		resp["message"] = "The transfer failed. Your earnings are back in your ProxyHubb wallet."
	case models.CashoutFailed:
		resp["message"] = "Cash-out failed. Contact support with your reference."
	default:
		resp["message"] = "Processing. This can take a few minutes."
	}
	if err != nil && !errors.Is(err, errCashoutNotReady) {
		resp["detail"] = err.Error()
	}
	return resp
}

func setCashoutStatus(p *models.Cashout, status models.CashoutStatus, fields map[string]any) error {
	if fields == nil {
		fields = map[string]any{}
	}
	fields["status"] = status
	fields["updated_at"] = time.Now().UTC()
	if err := db.DB.Model(&models.Cashout{}).Where("id = ?", p.ID).Updates(fields).Error; err != nil {
		return err
	}
	p.Status = status
	return nil
}

func recordCashoutError(p *models.Cashout, err error) {
	p.Attempts++
	p.LastError = err.Error()
	db.DB.Model(&models.Cashout{}).Where("id = ?", p.ID).Updates(map[string]any{
		"attempts":   gorm.Expr("attempts + 1"),
		"last_error": truncate(err.Error(), 500),
		"updated_at": time.Now().UTC(),
	})
}

// processCashout moves one cash-out forward as far as it can. Safe to call
// repeatedly and concurrently (confirm request, webhook, reconciler).
func processCashout(ctx context.Context, reference string) (*models.Cashout, error) {
	unlock, locked := fiatLock("cashout:" + reference)
	if !locked {
		return nil, errCashoutNotReady
	}
	defer unlock()

	var p models.Cashout
	if err := db.DB.Where("reference = ?", reference).First(&p).Error; err != nil {
		return nil, fmt.Errorf("unknown cash-out reference: %w", err)
	}

	for {
		switch p.Status {
		case models.CashoutQuoted, models.CashoutCompleted, models.CashoutRefunded,
			models.CashoutExpired, models.CashoutFailed:
			return &p, nil

		case models.CashoutConfirmed:
			buyer, err := loadManagedBuyer(p.UserID)
			if err != nil {
				recordCashoutError(&p, err)
				return &p, err
			}
			float, err := cashoutFloatAddress()
			if err != nil {
				recordCashoutError(&p, err)
				return &p, err
			}
			bal, err := fiatWalletBalance(ctx, buyer.address)
			if err != nil {
				recordCashoutError(&p, fmt.Errorf("read wallet balance: %w", err))
				return &p, err
			}
			if bal < uint64(p.Lamports)+cashoutTxFeeLamports {
				// Nothing has moved: end it cleanly.
				_ = setCashoutStatus(&p, models.CashoutFailed, map[string]any{"last_error": "insufficient balance at sweep time"})
				return &p, errors.New("not enough earnings in the wallet any more")
			}
			tx, err := cashoutSignSweep(ctx, buyer.signer, buyer.address, float, uint64(p.Lamports))
			if err != nil {
				recordCashoutError(&p, fmt.Errorf("sign sweep: %w", err))
				return &p, err
			}
			sig := tx.Signatures[0].String()
			now := time.Now().UTC()
			// Record before sending: a retry then checks this exact transaction.
			if err := setCashoutStatus(&p, models.CashoutSweeping, map[string]any{"sweep_tx": sig, "sweep_sent_at": now}); err != nil {
				return &p, err
			}
			p.SweepTx, p.SweepSentAt = sig, &now
			if err := cashoutSendSigned(ctx, tx); err != nil {
				recordCashoutError(&p, fmt.Errorf("send sweep: %w", err))
				// Stay in sweeping: the status check below decides whether it landed.
			}

		case models.CashoutSweeping:
			landed, err := waitForSweep(ctx, &p)
			if err != nil {
				recordCashoutError(&p, err)
				return &p, err
			}
			if !landed && p.Status != models.CashoutConfirmed {
				return &p, errCashoutNotReady
			}
			// landed -> swept; dropped -> back to confirmed and re-signed next loop

		case models.CashoutSwept:
			var dest models.PayoutDestination
			if err := db.DB.First(&dest, "id = ?", p.DestinationID).Error; err != nil {
				recordCashoutError(&p, err)
				return &p, err
			}
			tr, err := cashoutTransfer(ctx, p.Reference, p.AmountMinor, dest.RecipientCode, "ProxyHubb earnings")
			if err != nil {
				// A retry after a crash: the transfer may already exist under this reference.
				if existing, verr := cashoutVerifyTransfer(ctx, p.Reference); verr == nil && existing != nil {
					tr = existing
				} else {
					recordCashoutError(&p, fmt.Errorf("paystack transfer: %w", err))
					return &p, err
				}
			}
			if err := setCashoutStatus(&p, models.CashoutTransferring, map[string]any{"transfer_code": tr.TransferCode}); err != nil {
				return &p, err
			}
			if done, err := applyTransferStatus(&p, tr.Status); done || err != nil {
				return &p, err
			}
			if p.Status == models.CashoutTransferring {
				return &p, errCashoutNotReady
			}
			// refunding: fall through to the refund step on the next loop

		case models.CashoutTransferring:
			tr, err := cashoutVerifyTransfer(ctx, p.Reference)
			if err != nil {
				recordCashoutError(&p, fmt.Errorf("verify transfer: %w", err))
				return &p, err
			}
			done, err := applyTransferStatus(&p, tr.Status)
			if err != nil {
				return &p, err
			}
			if !done && p.Status == models.CashoutTransferring {
				return &p, errCashoutNotReady
			}

		case models.CashoutRefunding:
			if p.RefundStarted != nil {
				// Started before but no tx recorded: it may have gone out. Never resend.
				_ = setCashoutStatus(&p, models.CashoutFailed, map[string]any{"last_error": "refund outcome unknown; check refund to managed wallet manually"})
				logging.Error(errors.New("refund outcome unknown")).Str("reference", p.Reference).
					Msg("ALERT: cash-out refund needs manual check")
				return &p, errors.New("refund needs a manual check")
			}
			buyer, err := loadManagedBuyer(p.UserID)
			if err != nil {
				recordCashoutError(&p, err)
				return &p, err
			}
			now := time.Now().UTC()
			if err := db.DB.Model(&models.Cashout{}).Where("id = ?", p.ID).Update("refund_started_at", now).Error; err != nil {
				return &p, err
			}
			p.RefundStarted = &now
			sig, err := cashoutRefund(ctx, buyer.address, uint64(p.Lamports))
			if err != nil {
				// Not sent (velocity guard, RPC before broadcast): safe to allow a retry.
				db.DB.Model(&models.Cashout{}).Where("id = ?", p.ID).Update("refund_started_at", nil)
				p.RefundStarted = nil
				recordCashoutError(&p, fmt.Errorf("refund: %w", err))
				return &p, err
			}
			if err := setCashoutStatus(&p, models.CashoutRefunded, map[string]any{"refund_tx": sig}); err != nil {
				return &p, err
			}

		default:
			return &p, fmt.Errorf("unexpected cash-out status %q", p.Status)
		}
	}
}

// applyTransferStatus maps a Paystack transfer status. done=true when the cash-out
// reached a terminal state.
func applyTransferStatus(p *models.Cashout, status string) (bool, error) {
	switch strings.ToLower(status) {
	case "success":
		return true, setCashoutStatus(p, models.CashoutCompleted, map[string]any{"last_error": ""})
	case "failed", "reversed", "abandoned", "rejected":
		return false, setCashoutStatus(p, models.CashoutRefunding, map[string]any{"last_error": "paystack transfer " + status})
	default: // pending, otp, received, queued
		return false, nil
	}
}

// waitForSweep checks the recorded sweep signature, polling briefly so a normal
// cash-out finishes in one request. A sweep never seen after the blockhash expires
// cannot land; the row goes back to confirmed and is re-signed.
func waitForSweep(ctx context.Context, p *models.Cashout) (bool, error) {
	deadline := time.Now().Add(cashoutInlineWait)
	for {
		found, confirmed, err := cashoutSigStatus(ctx, p.SweepTx)
		if err != nil && found {
			// Landed but failed: no SOL moved. Re-sign from confirmed.
			_ = setCashoutStatus(p, models.CashoutConfirmed, map[string]any{"sweep_tx": "", "sweep_sent_at": nil})
			return false, fmt.Errorf("sweep failed on chain: %w", err)
		}
		if err == nil && confirmed {
			return true, setCashoutStatus(p, models.CashoutSwept, nil)
		}
		if err == nil && !found && p.SweepSentAt != nil && time.Since(*p.SweepSentAt) > cashoutSweepDropAfter {
			return false, setCashoutStatus(p, models.CashoutConfirmed, map[string]any{"sweep_tx": "", "sweep_sent_at": nil})
		}
		if time.Now().After(deadline) {
			return false, nil
		}
		select {
		case <-ctx.Done():
			return false, nil
		case <-time.After(2 * time.Second):
		}
	}
}

// reconcileCashouts expires stale quotes and pushes open cash-outs forward.
func reconcileCashouts(ctx context.Context) {
	db.DB.Model(&models.Cashout{}).
		Where("status = ? AND created_at < ?", models.CashoutQuoted, time.Now().Add(-cashoutQuoteTTL)).
		Updates(map[string]any{"status": models.CashoutExpired, "updated_at": time.Now().UTC()})

	var rows []models.Cashout
	db.DB.Where("status IN ? AND updated_at < ?", models.CashoutOpenStatuses, time.Now().Add(-30*time.Second)).
		Order("created_at ASC").Limit(50).Find(&rows)
	for i := range rows {
		p := rows[i]
		if p.Attempts >= fiatMaxAttempts {
			if p.Status == models.CashoutConfirmed {
				_ = setCashoutStatus(&p, models.CashoutFailed, nil) // nothing moved yet
			} else {
				logging.Error(errors.New(p.LastError)).Str("reference", p.Reference).Str("status", string(p.Status)).
					Msg("ALERT: cash-out stuck after repeated failures")
			}
			continue
		}
		stepCtx, cancel := context.WithTimeout(ctx, 3*time.Minute)
		_, err := processCashout(stepCtx, p.Reference)
		cancel()
		if err != nil && !errors.Is(err, errCashoutNotReady) {
			logging.Warn().Err(err).Str("reference", p.Reference).Msg("cashout reconciler: still incomplete")
		}
	}
}
