package api

// Fiat checkout for managed-wallet buyers (Google sign-in users).
//
//	browser                    control-api                      Paystack / Solana
//	POST pay/paystack   --->   quote GHS for the SOL shortfall --> Initialize
//	Paystack popup      --->   (user pays by card / MoMo)
//	POST pay/paystack/verify   processFiatPayment(ref):
//	  (or webhook)               quoted   -> paid      Verify: success, exact amount, GHS
//	                             paid     -> funded    treasury SendSOL -> managed wallet
//	                             funded   -> escrowed  managed wallet signs initialize_escrow
//	                             escrowed -> active    confirmOrderEscrowCore (same as Phantom)
//
// Each step is idempotent and resumable; runFiatPaymentReconciler retries stuck rows.
// The escrow is the normal on-chain escrow with buyer = managed wallet, so settlement,
// provider payout and refund-of-remainder (back to the managed wallet) are unchanged.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/custody"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/fx"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/marketplace"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/orders/fsm"
	"github.com/proxyhubb/control-api/internal/paystack"
	"github.com/proxyhubb/control-api/internal/prices"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
	"github.com/proxyhubb/control-api/internal/solana"
	"gorm.io/gorm"
)

const (
	// Two transaction fees (escrow init + headroom) for the managed wallet, which pays its own fees.
	fiatFeeBufferLamports uint64 = 20_000
	fiatQuoteReuseWindow         = 20 * time.Minute
	fiatMaxAttempts              = 10
	fiatConfirmTimeout           = 60 * time.Second
	legacyEscrowLifetime         = 24 * time.Hour // matches web initializeEscrow default
	fiatInlineWait               = 30 * time.Second
	fiatTxDropAfter              = 90 * time.Second // blockhash lifetime; unseen after this never lands
)

var (
	errFiatNotPaidYet   = errors.New("payment not completed yet")
	errFiatDisabled     = errors.New("fiat payments are disabled")
	errNotManagedBuyer  = errors.New("not a managed-wallet buyer")
	errFiatOrderSettled = errors.New("order can no longer take this payment")
	errFiatInProgress   = errors.New("payment is still being set up")
)

// Seams for tests (same pattern as verifyGoogleToken / probeEdgeNode).
var (
	paystackInitialize = paystack.Initialize
	paystackVerify     = paystack.Verify
	paystackRefund     = paystack.Refund
	fiatUSDToGHS       = fx.USDToGHS
	fiatSOLPriceUSD    = prices.GetSOLPrice
	fiatPrepareEscrow  = prepareOrderEscrow
	fiatConfirmEscrow  = confirmOrderEscrowCore
	fiatLoadKEK        = custody.DefaultKEK

	// Fresh confirmed read: decisions right after a transfer must not see a cached balance.
	fiatWalletBalance = func(ctx context.Context, addr sol.PublicKey) (uint64, error) {
		oracle := solana.GetOracle()
		if oracle == nil {
			return 0, errors.New("solana oracle not configured")
		}
		return oracle.GetBalanceFresh(ctx, addr)
	}
	fiatEscrowRent = cachedEscrowRent
	// fiatBuildFundEscrowTx builds the treasury-signed top-up + initialize_escrow tx.
	fiatBuildFundEscrowTx = func(ctx context.Context, fund uint64, p solana.InitializeEscrowParams) (*sol.Transaction, error) {
		oracle := solana.GetOracle()
		if oracle == nil {
			return nil, errors.New("solana oracle not configured")
		}
		return oracle.BuildFundAndInitEscrowTx(ctx, fund, p)
	}
	fiatSendSigned = func(ctx context.Context, tx *sol.Transaction) error {
		oracle := solana.GetOracle()
		if oracle == nil {
			return errors.New("solana oracle not configured")
		}
		_, err := oracle.SendSignedTransaction(ctx, tx)
		return err
	}
	fiatSigStatus = func(ctx context.Context, sig string) (bool, bool, error) {
		oracle := solana.GetOracle()
		if oracle == nil {
			return false, false, errors.New("solana oracle not configured")
		}
		return oracle.SignatureStatus(ctx, sig)
	}
	// fiatTreasurySend sends SOL from the treasury hot wallet (velocity-guarded) and waits for confirmation.
	fiatTreasurySend = func(ctx context.Context, to sol.PublicKey, lamports uint64) (string, error) {
		oracle := solana.GetOracle()
		if oracle == nil {
			return "", errors.New("solana oracle not configured")
		}
		sig, err := oracle.SendSOL(ctx, to, lamports)
		if err != nil {
			return "", err
		}
		return sig, oracle.WaitForConfirmation(ctx, sig, fiatConfirmTimeout)
	}
	// fiatFetchEscrow returns the escrow at pda if it exists and still holds funds.
	fiatFetchEscrow = func(ctx context.Context, pda sol.PublicKey) *solana.Escrow {
		oracle := solana.GetOracle()
		if oracle == nil {
			return nil
		}
		e, err := oracle.FetchEscrow(ctx, pda)
		if err != nil || e == nil || e.Amount == 0 ||
			(e.Status != solana.EscrowPending && e.Status != solana.EscrowActive) {
			return nil
		}
		return e
	}
	// fiatLegacyEscrow returns the funded legacy escrow between buyer and seller, if any.
	fiatLegacyEscrow = func(ctx context.Context, buyer, seller sol.PublicKey) *solana.Escrow {
		oracle := solana.GetOracle()
		if oracle == nil {
			return nil
		}
		pda, _, err := oracle.GetEscrowPDA(buyer, seller)
		if err != nil {
			return nil
		}
		return fiatFetchEscrow(ctx, pda)
	}
	// fiatSubmitEscrow builds initialize_escrow with the managed wallet as buyer and
	// fee payer, signs it with the sealed key, sends it and waits for confirmation.
	fiatSubmitEscrow = func(ctx context.Context, signer *custody.Signer, p solana.InitializeEscrowParams) (string, error) {
		oracle := solana.GetOracle()
		if oracle == nil {
			return "", errors.New("solana oracle not configured")
		}
		ix, err := solana.BuildInitializeEscrowIx(oracle.GetProgramID(), p)
		if err != nil {
			return "", err
		}
		blockhash, err := oracle.LatestBlockhash(ctx)
		if err != nil {
			return "", err
		}
		tx, err := sol.NewTransaction([]sol.Instruction{ix}, blockhash, sol.TransactionPayer(p.Buyer))
		if err != nil {
			return "", err
		}
		if err := signer.SignTransactionContext(ctx, tx); err != nil {
			return "", err
		}
		sig, err := oracle.SendSignedTransaction(ctx, tx)
		if err != nil {
			return "", err
		}
		return sig, oracle.WaitForConfirmation(ctx, sig, fiatConfirmTimeout)
	}
)

// fiatEscrowFunded reports whether the escrow PDA already exists with funds.
func fiatEscrowFunded(ctx context.Context, pda sol.PublicKey) bool {
	return fiatFetchEscrow(ctx, pda) != nil
}

// escrowOpenedForPayment reports whether an existing escrow was opened by this payment
// (crash-resume, or a funding tx that landed after we gave up on it) rather than
// belonging to an earlier plan with the same seller.
func escrowOpenedForPayment(e *solana.Escrow, p *models.FiatPayment) bool {
	return e.CreatedAt >= p.CreatedAt.Add(-time.Minute).Unix()
}

// RegisterFiatOrderRoutes adds the managed-wallet payment routes to the purchase group.
func RegisterFiatOrderRoutes(rg *gin.RouterGroup) {
	rg.POST("/orders/:id/pay/paystack", requireBulkScope("orders:create"), StrictRateLimit(), quotePaystackPayment)
	rg.POST("/orders/:id/pay/paystack/verify", requireBulkScope("orders:create"), verifyPaystackPayment)
	rg.POST("/orders/:id/pay/balance", requireBulkScope("orders:create"), StrictRateLimit(), payOrderFromManagedBalance)
	rg.GET("/listings/:id/paystack-preview", requireBulkScope("orders:create"), previewPaystackPrice)
	rg.GET("/listings/:id/checkout-preview", requireBulkScope("orders:create"), previewManagedCheckout)
}

// RegisterPaystackWebhook mounts the unauthenticated Paystack webhook.
func RegisterPaystackWebhook(rg *gin.RouterGroup) {
	rg.POST("/webhooks/paystack", handlePaystackWebhook)
}

func fiatPaymentsEnabled() bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("FIAT_PAYMENTS_ENABLED")))
	return (v == "true" || v == "1") && paystack.Configured()
}

func envFloat(name string, def float64) float64 {
	if v := strings.TrimSpace(os.Getenv(name)); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil && f >= 0 {
			return f
		}
	}
	return def
}

// managedBuyer is a buyer whose primary Solana wallet is their server-held wallet.
type managedBuyer struct {
	userID  uuid.UUID
	address sol.PublicKey
	signer  *custody.Signer
}

// loadManagedBuyer checks the user has an embedded wallet that is also their primary
// linked wallet (the escrow buyer), and that the KEK can unseal it.
func loadManagedBuyer(userID uuid.UUID) (*managedBuyer, error) {
	row, err := custody.FindWallet(db.DB, userID)
	if err != nil {
		if errors.Is(err, custody.ErrNoEmbeddedWallet) {
			return nil, errNotManagedBuyer
		}
		return nil, err
	}
	var primary models.LinkedWallet
	if err := db.DB.Where("user_id = ? AND chain = ? AND is_primary = true", userID, models.ChainSolana).First(&primary).Error; err != nil {
		return nil, errNotManagedBuyer
	}
	if primary.Address != row.Address {
		return nil, errNotManagedBuyer
	}
	kek, err := fiatLoadKEK()
	if err != nil {
		return nil, err
	}
	signer, err := custody.NewSigner(db.DB, kek, userID)
	if err != nil {
		return nil, err
	}
	addr, err := sol.PublicKeyFromBase58(row.Address)
	if err != nil {
		return nil, err
	}
	return &managedBuyer{userID: userID, address: addr, signer: signer}, nil
}

func loadBuyerOrder(c *gin.Context) (*models.Order, uuid.UUID, bool) {
	userID, err := parseAuthenticatedUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user ID"})
		return nil, uuid.Nil, false
	}
	orderID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid order ID"})
		return nil, uuid.Nil, false
	}
	var order models.Order
	if err := db.DB.First(&order, "id = ?", orderID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
		return nil, uuid.Nil, false
	}
	if order.BuyerID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Not your order"})
		return nil, uuid.Nil, false
	}
	return &order, userID, true
}

func respondManagedBuyerError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, errNotManagedBuyer):
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "This payment option is for accounts with a ProxyHubb wallet. Pay with your own Solana wallet instead.",
			"code":  "not_managed_wallet",
		})
	case errors.Is(err, custody.ErrLocalKEKInStrictEnv), errors.Is(err, custody.ErrKEKNotConfigured), errors.Is(err, custody.ErrKEKUnavailable), errors.Is(err, custody.ErrUnknownKEK):
		logging.Error(err).Msg("fiat: managed wallet key store unavailable")
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Card payments are temporarily unavailable"})
	default:
		logging.Error(err).Msg("fiat: load managed buyer")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not load your wallet"})
	}
}

var escrowRentCache atomic.Uint64

// cachedEscrowRent is the rent for one escrow account. It depends only on the account
// size, so it is read once and reused (one less RPC call per checkout).
func cachedEscrowRent(ctx context.Context) (uint64, error) {
	if v := escrowRentCache.Load(); v > 0 {
		return v, nil
	}
	oracle := solana.GetOracle()
	if oracle == nil {
		return 0, errors.New("solana oracle not configured")
	}
	rent, err := oracle.EscrowRentLamports(ctx)
	if err != nil {
		return 0, err
	}
	escrowRentCache.Store(rent)
	return rent, nil
}

// managedEscrowTotal is what the managed wallet must hold to open the order's escrow:
// the escrow amount, the escrow account's rent and the transaction fees.
func managedEscrowTotal(ctx context.Context, order *models.Order) (uint64, error) {
	rent, err := fiatEscrowRent(ctx)
	if err != nil {
		return 0, err
	}
	// The wallet itself must stay rent-exempt after paying into escrow: Solana rejects a
	// transaction that leaves an account above zero but below the rent minimum. The
	// reserve stays in the user's wallet as balance.
	return models.SOLToLamports(order.AmountLockedSOL) + rent + fiatFeeBufferLamports + rentExemptMinLamports, nil
}

// fiatMaxTopUpLamports caps the float top-up for a funded payment whose cost grew
// slightly since the quote (rent or fee changes). Anything larger needs a new quote.
const fiatMaxTopUpLamports uint64 = 2_000_000

// quotePaystackPayment prices the SOL the managed wallet is missing for this order in
// GHS and opens a Paystack transaction for it.
func quotePaystackPayment(c *gin.Context) {
	if !fiatPaymentsEnabled() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Card and mobile money payments are not enabled", "code": "fiat_disabled"})
		return
	}
	order, userID, ok := loadBuyerOrder(c)
	if !ok {
		return
	}
	if order.Status != models.OrderStatusPending && order.Status != models.OrderStatusPendingPayment {
		c.JSON(http.StatusConflict, gin.H{"error": "Order is not awaiting payment", "status": order.Status})
		return
	}
	buyer, err := loadManagedBuyer(userID)
	if err != nil {
		respondManagedBuyerError(c, err)
		return
	}
	ctx := c.Request.Context()

	// Reuse a fresh open quote so a reopened popup doesn't create a second charge.
	var open models.FiatPayment
	if err := db.DB.Where("order_id = ? AND status = ? AND created_at > ?", order.ID, models.FiatPaymentQuoted, time.Now().Add(-fiatQuoteReuseWindow)).
		Order("created_at DESC").First(&open).Error; err == nil && open.AccessCode != "" && order.Status == models.OrderStatusPendingPayment {
		c.JSON(http.StatusOK, fiatQuoteResponse(&open))
		return
	}

	if fiatPaymentInProgress(order.ID) {
		c.JSON(http.StatusConflict, gin.H{"error": "We already received a payment for this order and are finishing it.", "code": "payment_in_progress"})
		return
	}

	intent, problem := fiatPrepareEscrow(ctx, order, "api.orders.pay_paystack", false)
	if problem != nil {
		c.JSON(problem.Status, problem.Body)
		return
	}
	if !intent.Buyer.Equals(buyer.address) {
		respondManagedBuyerError(c, errNotManagedBuyer)
		return
	}
	// The escrow address is one per buyer and provider. If it is already open, this
	// order could never be funded, so stop before taking any money.
	if intent.AlreadyFunded {
		existing, _ := activePlanWithSeller(db.DB, userID, order.SellerID)
		var existingID *uuid.UUID
		if existing != nil {
			existingID = &existing.ID
		}
		cancelUnpaidOrder(order.ID, "api.orders.pay_paystack.active_plan")
		c.JSON(http.StatusConflict, activePlanExistsBody(existingID))
		return
	}

	total, err := managedEscrowTotal(ctx, order)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Could not reach Solana. Try again shortly."})
		return
	}
	balance, err := fiatWalletBalance(ctx, buyer.address)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Could not read your wallet balance. Try again shortly."})
		return
	}
	if balance >= total {
		c.JSON(http.StatusOK, gin.H{
			"pay_from_balance": true,
			"amount_sol":       models.LamportsToSOL(total),
			"balance_sol":      models.LamportsToSOL(balance),
		})
		return
	}
	shortfall := total - balance

	charge, err := priceFiatShortfall(ctx, shortfall)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}
	amountMinor := charge.AmountMinor

	if maxGHS := envFloat("FIAT_MAX_ORDER_GHS", 2000); float64(amountMinor) > maxGHS*100 {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Card payments are limited to GH₵%.0f per order. Choose less bandwidth.", maxGHS), "code": "fiat_order_limit"})
		return
	}
	var paidToday int64
	db.DB.Model(&models.FiatPayment{}).
		Where("user_id = ? AND status IN ? AND created_at > ?", userID,
			[]models.FiatPaymentStatus{models.FiatPaymentPaid, models.FiatPaymentFunded, models.FiatPaymentEscrowed, models.FiatPaymentActive},
			time.Now().Add(-24*time.Hour)).
		Select("COALESCE(SUM(amount_minor), 0)").Scan(&paidToday)
	if dailyGHS := envFloat("FIAT_DAILY_LIMIT_GHS", 5000); float64(paidToday+amountMinor) > dailyGHS*100 {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("You've reached today's card payment limit of GH₵%.0f.", dailyGHS), "code": "fiat_daily_limit"})
		return
	}

	email := fiatPayerEmail(userID)
	reference := "phub_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	init, err := paystackInitialize(ctx, paystack.InitializeRequest{
		Email:     email,
		Amount:    amountMinor,
		Currency:  "GHS",
		Reference: reference,
		Metadata: map[string]any{
			"order_id": order.ID.String(),
			"user_id":  userID.String(),
			"purpose":  "proxyhubb_bandwidth",
		},
	})
	if err != nil {
		logging.Error(err).Str("order_id", order.ID.String()).Msg("fiat: paystack initialize failed")
		c.JSON(http.StatusBadGateway, gin.H{"error": "Could not start the payment. Try again shortly."})
		return
	}

	row := models.FiatPayment{
		ID:             uuid.New(),
		OrderID:        order.ID,
		UserID:         userID,
		Provider:       "paystack",
		Reference:      reference,
		AccessCode:     init.AccessCode,
		AmountMinor:    amountMinor,
		Currency:       "GHS",
		USDAmount:      charge.USD,
		USDGHSRate:     charge.USDGHSRate,
		SOLPriceUSD:    charge.SOLPriceUSD,
		LamportsNeeded: int64(shortfall),
		Status:         models.FiatPaymentQuoted,
	}
	if err := db.DB.Create(&row).Error; err != nil {
		logging.Error(err).Str("reference", reference).Msg("fiat: store quote")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not start the payment"})
		return
	}
	c.JSON(http.StatusOK, fiatQuoteResponse(&row))
}

// fiatCharge is a SOL amount priced in GHS for Paystack.
type fiatCharge struct {
	AmountMinor int64 // pesewas
	USD         float64
	SOLPriceUSD float64
	USDGHSRate  float64
}

// priceFiatShortfall prices lamports in GHS, including the Paystack fee buffer. The
// quote and the pre-checkout preview both use it so the preview matches the charge.
func priceFiatShortfall(ctx context.Context, lamports uint64) (*fiatCharge, error) {
	solUSD, err := fiatSOLPriceUSD(ctx)
	if err != nil || solUSD <= 0 {
		return nil, errors.New("SOL price unavailable. Try again shortly.")
	}
	usdGHS, err := fiatUSDToGHS(ctx)
	if err != nil {
		return nil, errors.New("Exchange rate unavailable. Try again shortly.")
	}
	usd := models.LamportsToSOL(lamports) * solUSD
	feeBuffer := envFloat("PAYSTACK_FEE_BUFFER_PCT", 4) / 100
	amountMinor := int64(math.Ceil(usd * usdGHS * (1 + feeBuffer) * 100))
	if amountMinor < 100 {
		amountMinor = 100 // GH₵1 minimum keeps the charge above Paystack's floor
	}
	return &fiatCharge{AmountMinor: amountMinor, USD: usd, SOLPriceUSD: solUSD, USDGHSRate: usdGHS}, nil
}

// fiatPaymentInProgress reports whether a payment for the order was already received.
func fiatPaymentInProgress(orderID uuid.UUID) bool {
	var n int64
	db.DB.Model(&models.FiatPayment{}).
		Where("order_id = ? AND status IN ?", orderID, []models.FiatPaymentStatus{
			models.FiatPaymentPaid, models.FiatPaymentFunded, models.FiatPaymentEscrowed,
		}).Count(&n)
	return n > 0
}

// managedCheckout is what a managed-wallet buyer's wallet must hold to buy a listing,
// worked out before any order exists. Both checkout previews start from it.
type managedCheckout struct {
	buyer    *managedBuyer
	usdTotal float64
	solUSD   float64
	escrow   uint64 // lamports locked in escrow for the provider
	total    uint64 // lamports the wallet must hold: escrow + escrow rent + fees + reserve
	balance  uint64
	// activePlan is set (and nothing else is) when the buyer already has a plan with
	// this provider, which blocks a second escrow.
	activePlan gin.H
}

// shortfall is the SOL the wallet is missing for this checkout.
func (m *managedCheckout) shortfall() uint64 {
	if m.balance >= m.total {
		return 0
	}
	return m.total - m.balance
}

// loadManagedCheckout reads the listing, the buyer's managed wallet and its balance for
// `gb` of bandwidth. On failure it has already written the error response.
func loadManagedCheckout(c *gin.Context) (*managedCheckout, bool) {
	userID, err := parseAuthenticatedUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user ID"})
		return nil, false
	}
	gb, err := strconv.ParseFloat(c.Query("gb"), 64)
	if err != nil || gb <= 0 || gb > 10_000 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "gb must be a positive number"})
		return nil, false
	}
	var listing models.ProxyListing
	if err := db.DB.First(&listing, "id = ?", c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Listing not found"})
		return nil, false
	}
	buyer, err := loadManagedBuyer(userID)
	if err != nil {
		respondManagedBuyerError(c, err)
		return nil, false
	}
	ctx := c.Request.Context()
	out := &managedCheckout{buyer: buyer}

	existing, err := activePlanWithSeller(db.DB, userID, listing.SellerID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to check existing plans"})
		return nil, false
	}
	if existing != nil {
		out.activePlan = gin.H{
			"active_plan":          true,
			"active_plan_order_id": existing.ID,
			"active_plan_gb":       existing.BandwidthGB,
			"active_plan_since":    existing.CreatedAt,
		}
		return out, true
	}
	// An escrow with this provider can also exist without a live order (for example
	// one whose order was removed). It blocks a new escrow just the same.
	var sellerWallet models.LinkedWallet
	if err := db.DB.Where("user_id = ? AND chain = ? AND is_primary = true", listing.SellerID, models.ChainSolana).
		First(&sellerWallet).Error; err == nil {
		if seller, err := sol.PublicKeyFromBase58(sellerWallet.Address); err == nil && fiatLegacyEscrow(ctx, buyer.address, seller) != nil {
			out.activePlan = gin.H{"active_plan": true}
			return out, true
		}
	}

	out.usdTotal = calculatePriceWithDiscounts(&listing, gb)
	out.solUSD, err = fiatSOLPriceUSD(ctx)
	if err != nil || out.solUSD <= 0 {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "SOL price unavailable. Try again shortly."})
		return nil, false
	}
	rent, err := fiatEscrowRent(ctx)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Could not reach Solana. Try again shortly."})
		return nil, false
	}
	out.escrow = models.SOLToLamports(out.usdTotal / out.solUSD)
	out.total = out.escrow + rent + fiatFeeBufferLamports + rentExemptMinLamports
	out.balance, err = fiatWalletBalance(ctx, buyer.address)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Could not read your wallet balance. Try again shortly."})
		return nil, false
	}
	return out, true
}

// fiatCreditGHS is the part of the wallet balance (above the rent reserve) that a card
// payment would not need to charge again, in GHS.
func fiatCreditGHS(m *managedCheckout, charge *fiatCharge) float64 {
	if m.balance <= rentExemptMinLamports {
		return 0
	}
	credit := models.LamportsToSOL(m.balance-rentExemptMinLamports) * m.solUSD * charge.USDGHSRate
	return math.Floor(credit*100) / 100
}

// previewPaystackPrice shows a managed-wallet buyer the exact GHS charge for a listing
// and bandwidth before any order or Paystack transaction exists.
//
// Kept for web builds released before the SOL-first checkout; new code calls
// previewManagedCheckout, which also works while card payments are off.
func previewPaystackPrice(c *gin.Context) {
	if !fiatPaymentsEnabled() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Card and mobile money payments are not enabled", "code": "fiat_disabled"})
		return
	}
	m, ok := loadManagedCheckout(c)
	if !ok {
		return
	}
	if m.activePlan != nil {
		c.JSON(http.StatusOK, m.activePlan)
		return
	}
	resp := gin.H{"active_plan": false, "usd_total": m.usdTotal}
	if m.shortfall() == 0 {
		resp["pay_from_balance"] = true
		resp["amount_ghs"] = 0
		c.JSON(http.StatusOK, resp)
		return
	}
	charge, err := priceFiatShortfall(c.Request.Context(), m.shortfall())
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}
	resp["amount_ghs"] = float64(charge.AmountMinor) / 100
	if credit := fiatCreditGHS(m, charge); credit > 0 {
		resp["credit_ghs"] = credit
	}
	c.JSON(http.StatusOK, resp)
}

// previewManagedCheckout is the SOL-first checkout preview for a managed-wallet buyer.
// SOL in the ProxyHubb wallet is the main way to pay; card and mobile money only buy
// the SOL the wallet is missing, and only when they are enabled. It never fails just
// because card payments are off or their GHS price cannot be worked out.
func previewManagedCheckout(c *gin.Context) {
	m, ok := loadManagedCheckout(c)
	if !ok {
		return
	}
	fiatOn := fiatPaymentsEnabled()
	if m.activePlan != nil {
		m.activePlan["fiat_enabled"] = fiatOn
		c.JSON(http.StatusOK, m.activePlan)
		return
	}
	short := m.shortfall()
	resp := gin.H{
		"active_plan":      false,
		"usd_total":        m.usdTotal,
		"sol_price_usd":    m.solUSD,
		"amount_sol":       models.LamportsToSOL(m.escrow),
		"required_sol":     models.LamportsToSOL(m.total),
		"balance_sol":      models.LamportsToSOL(m.balance),
		"shortfall_sol":    models.LamportsToSOL(short),
		"pay_from_balance": short == 0,
		"wallet_address":   m.buyer.address.String(),
		"fiat_enabled":     fiatOn,
	}
	if short > 0 && fiatOn {
		if charge, err := priceFiatShortfall(c.Request.Context(), short); err != nil {
			resp["fiat_error"] = err.Error()
		} else {
			resp["amount_ghs"] = float64(charge.AmountMinor) / 100
			if credit := fiatCreditGHS(m, charge); credit > 0 {
				resp["credit_ghs"] = credit
			}
		}
	}
	c.JSON(http.StatusOK, resp)
}

func fiatQuoteResponse(p *models.FiatPayment) gin.H {
	return gin.H{
		"reference":    p.Reference,
		"access_code":  p.AccessCode,
		"amount_minor": p.AmountMinor,
		"amount_ghs":   float64(p.AmountMinor) / 100,
		"currency":     p.Currency,
		"amount_sol":   models.LamportsToSOL(uint64(p.LamportsNeeded)),
		"expires_in":   int(time.Until(p.CreatedAt.Add(fiatQuoteReuseWindow)).Seconds()),
		"test_mode":    paystack.IsTestKey(),
	}
}

// fiatPayerEmail is the receipt email for Paystack. The vaulted Google email is
// decrypted by the User AfterFind hook; a placeholder is used if none is stored.
func fiatPayerEmail(userID uuid.UUID) string {
	var u models.User
	if err := db.DB.First(&u, "id = ?", userID).Error; err == nil {
		if e := strings.TrimSpace(u.Email); e != "" && !strings.HasSuffix(e, "@wallet.proxyhubb.com") {
			return e
		}
	}
	return userID.String() + "@users.proxyhubb.com"
}

type verifyPaystackRequest struct {
	Reference string `json:"reference" binding:"required"`
}

// verifyPaystackPayment runs the payment forward after the popup reports success.
// Webhooks cannot reach a local stack, so this is the main trigger in development.
func verifyPaystackPayment(c *gin.Context) {
	order, userID, ok := loadBuyerOrder(c)
	if !ok {
		return
	}
	var req verifyPaystackRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "reference is required"})
		return
	}
	var row models.FiatPayment
	if err := db.DB.Where("reference = ? AND order_id = ? AND user_id = ?", req.Reference, order.ID, userID).First(&row).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Payment not found"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 150*time.Second)
	defer cancel()
	// The browser polls this every few seconds. Once a step has failed, leave retries
	// to the reconciler's pace so polling doesn't burn through the attempt budget.
	inFlight := row.Status == models.FiatPaymentPaid || row.Status == models.FiatPaymentFunded || row.Status == models.FiatPaymentEscrowed
	if inFlight && row.LastError != "" && time.Since(row.UpdatedAt) < 20*time.Second {
		c.JSON(http.StatusAccepted, gin.H{
			"status": row.Status, "order_id": order.ID, "reference": row.Reference,
			"message": "Your payment was received. We're finishing the setup and will retry automatically.",
		})
		return
	}
	p, err := processFiatPayment(ctx, req.Reference)
	if p == nil {
		p = &row
	}
	resp := gin.H{"status": p.Status, "order_id": order.ID, "reference": p.Reference, "amount_ghs": float64(p.AmountMinor) / 100}
	switch {
	case p.Status == models.FiatPaymentRefunded:
		resp["message"] = fmt.Sprintf("We couldn't set up this order, so your GH₵%.2f was refunded to your card or mobile money. It can take a few days to show.", float64(p.AmountMinor)/100)
		c.JSON(http.StatusOK, resp)
	case p.Status == models.FiatPaymentFailed && p.FundingTx == "" && p.LamportsFunded == 0:
		resp["message"] = "This checkout was not completed. You were not charged."
		c.JSON(http.StatusOK, resp)
	case p.Status == models.FiatPaymentFailed:
		resp["message"] = "We couldn't set up this order. Your payment is kept as credit in your ProxyHubb wallet and is used first on your next order."
		c.JSON(http.StatusOK, resp)
	case err == nil:
		c.JSON(http.StatusOK, resp)
	case errors.Is(err, errFiatNotPaidYet):
		resp["message"] = "Waiting for Paystack to confirm your payment"
		c.JSON(http.StatusAccepted, resp)
	default:
		resp["message"] = "Your payment was received. We're finishing the setup and will retry automatically."
		resp["error"] = err.Error()
		c.JSON(http.StatusAccepted, resp)
	}
}

// handlePaystackWebhook is only a trigger: the body is trusted for nothing except the
// reference, and processFiatPayment re-verifies the charge with Paystack's API.
func handlePaystackWebhook(c *gin.Context) {
	body, err := io.ReadAll(io.LimitReader(c.Request.Body, 1<<20))
	if err != nil {
		c.Status(http.StatusBadRequest)
		return
	}
	if !paystack.ValidSignature(body, c.GetHeader("x-paystack-signature")) {
		logging.Warn().Str("ip", c.ClientIP()).Msg("paystack webhook rejected: bad signature")
		c.Status(http.StatusUnauthorized)
		return
	}
	var evt struct {
		Event string `json:"event"`
		Data  struct {
			Reference string `json:"reference"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &evt); err != nil || evt.Data.Reference == "" {
		c.Status(http.StatusOK)
		return
	}
	ref := evt.Data.Reference
	switch evt.Event {
	case "charge.success":
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
			defer cancel()
			if _, err := processFiatPayment(ctx, ref); err != nil && !errors.Is(err, errFiatNotPaidYet) && !errors.Is(err, errFiatInProgress) {
				logging.Warn().Err(err).Str("reference", ref).Msg("paystack webhook: processing incomplete; reconciler will retry")
			}
		}()
	case "transfer.success", "transfer.failed", "transfer.reversed":
		// Cash-outs re-verify the transfer with Paystack; the event is only a nudge.
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
			defer cancel()
			if _, err := processCashout(ctx, ref); err != nil && !errors.Is(err, errCashoutNotReady) {
				logging.Warn().Err(err).Str("reference", ref).Msg("paystack webhook: cash-out incomplete; reconciler will retry")
			}
		}()
	}
	c.Status(http.StatusOK)
}

// payOrderFromManagedBalance opens the escrow from SOL already in the managed wallet
// (for example the remainder refunded by an earlier escrow). No Paystack charge.
func payOrderFromManagedBalance(c *gin.Context) {
	order, userID, ok := loadBuyerOrder(c)
	if !ok {
		return
	}
	if order.Status != models.OrderStatusPending && order.Status != models.OrderStatusPendingPayment {
		c.JSON(http.StatusConflict, gin.H{"error": "Order is not awaiting payment", "status": order.Status})
		return
	}
	buyer, err := loadManagedBuyer(userID)
	if err != nil {
		respondManagedBuyerError(c, err)
		return
	}
	unlock, locked := fiatLock("order:" + order.ID.String())
	if !locked {
		c.JSON(http.StatusConflict, gin.H{"error": "A payment for this order is already in progress"})
		return
	}
	defer unlock()

	ctx, cancel := context.WithTimeout(c.Request.Context(), 150*time.Second)
	defer cancel()
	intent, problem := fiatPrepareEscrow(ctx, order, "api.orders.pay_balance", false)
	if problem != nil {
		c.JSON(problem.Status, problem.Body)
		return
	}
	if !intent.Buyer.Equals(buyer.address) {
		respondManagedBuyerError(c, errNotManagedBuyer)
		return
	}
	total, err := managedEscrowTotal(ctx, order)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Could not reach Solana. Try again shortly."})
		return
	}
	if balance, err := fiatWalletBalance(ctx, buyer.address); err != nil || balance < total {
		c.JSON(http.StatusPaymentRequired, gin.H{"error": "Your ProxyHubb balance is too low for this order", "code": "insufficient_balance"})
		return
	}
	escrowTx, err := openManagedEscrow(ctx, order, buyer)
	if err != nil {
		logging.Error(err).Str("order_id", order.ID.String()).Msg("pay/balance: escrow failed")
		c.JSON(http.StatusBadGateway, gin.H{"error": "Could not lock the payment in escrow. Try again shortly."})
		return
	}
	if _, _, problem := fiatConfirmEscrow(solana.WithConfirmedReads(ctx), order, escrowTx, "api.orders.pay_balance", "managed_balance"); problem != nil {
		c.JSON(problem.Status, problem.Body)
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": order.Status, "order_id": order.ID, "escrow_tx": escrowTx})
}

// topUpManagedWallet covers a small gap between what the wallet holds and what the
// escrow now needs (rent or fees moved since the quote). The escrow already existing
// means there is nothing to cover.
func topUpManagedWallet(ctx context.Context, p *models.FiatPayment, order *models.Order, buyer *managedBuyer) error {
	if pda, err := sol.PublicKeyFromBase58(order.EscrowPDA); err == nil && fiatEscrowFunded(ctx, pda) {
		return nil
	}
	total, err := managedEscrowTotal(ctx, order)
	if err != nil {
		return err
	}
	bal, err := fiatWalletBalance(ctx, buyer.address)
	if err != nil {
		return fmt.Errorf("read managed wallet balance: %w", err)
	}
	if bal >= total {
		return nil
	}
	gap := total - bal
	if gap > fiatMaxTopUpLamports {
		return fmt.Errorf("wallet is %d lamports short of the escrow cost; needs ops review", gap)
	}
	sig, err := fiatTreasurySend(ctx, buyer.address, gap)
	if err != nil {
		return fmt.Errorf("top-up transfer: %w", err)
	}
	logging.Info().Str("reference", p.Reference).Uint64("lamports", gap).Str("tx", sig).Msg("fiat: topped up managed wallet before escrow")
	return nil
}

// openManagedEscrow submits initialize_escrow from the managed wallet unless the
// order's escrow already exists on chain (a previous attempt landed).
func openManagedEscrow(ctx context.Context, order *models.Order, buyer *managedBuyer) (string, error) {
	params, err := managedEscrowParams(order, buyer)
	if err != nil {
		return "", err
	}
	if fiatEscrowFunded(ctx, params.EscrowPDA) {
		return "", nil
	}
	return fiatSubmitEscrow(ctx, buyer.signer, params)
}

// managedEscrowParams is the initialize_escrow call for an order paid from a managed wallet.
func managedEscrowParams(order *models.Order, buyer *managedBuyer) (solana.InitializeEscrowParams, error) {
	pda, err := sol.PublicKeyFromBase58(order.EscrowPDA)
	if err != nil {
		return solana.InitializeEscrowParams{}, fmt.Errorf("order has no valid escrow_pda: %w", err)
	}
	seller, err := sol.PublicKeyFromBase58(order.SellerWallet)
	if err != nil {
		return solana.InitializeEscrowParams{}, fmt.Errorf("order has no valid seller_wallet: %w", err)
	}
	multisig := order.EscrowSeedKind == escrowSeedKindMultisig
	expiresAt := order.EscrowExpiresAt
	if !multisig || expiresAt == 0 {
		expiresAt = time.Now().Add(legacyEscrowLifetime).Unix()
	}
	return solana.InitializeEscrowParams{
		Buyer:          buyer.address,
		Seller:         seller,
		EscrowPDA:      pda,
		AmountLamports: models.SOLToLamports(order.AmountLockedSOL),
		LimitUnits:     solana.LimitUnitsFromGiB(order.BandwidthGB),
		ExpiresAt:      expiresAt,
		Multisig:       multisig,
	}, nil
}

// waitForFiatFunding checks the recorded funding transaction, polling briefly so a
// normal checkout finishes in one request. Confirmed -> escrowed. Failed on chain or
// never seen after the blockhash expired -> funding_tx cleared so it is re-signed.
func waitForFiatFunding(ctx context.Context, p *models.FiatPayment) (bool, error) {
	deadline := time.Now().Add(fiatInlineWait)
	for {
		found, confirmed, err := fiatSigStatus(ctx, p.FundingTx)
		if err != nil && found {
			clearErr := setFiatStatus(p, models.FiatPaymentPaid, map[string]any{"funding_tx": "", "funding_sent_at": nil})
			p.FundingTx, p.FundingSentAt = "", nil
			if clearErr != nil {
				return false, clearErr
			}
			return false, fmt.Errorf("funding tx failed on chain: %w", err)
		}
		if err == nil && confirmed {
			return true, setFiatStatus(p, models.FiatPaymentEscrowed, map[string]any{"escrow_tx": p.FundingTx})
		}
		if err == nil && !found && p.FundingSentAt != nil && time.Since(*p.FundingSentAt) > fiatTxDropAfter {
			if err := setFiatStatus(p, models.FiatPaymentPaid, map[string]any{"funding_tx": "", "funding_sent_at": nil}); err != nil {
				return false, err
			}
			p.FundingTx, p.FundingSentAt = "", nil
			return false, nil
		}
		if time.Now().After(deadline) {
			return false, nil
		}
		select {
		case <-ctx.Done():
			return false, nil
		case <-time.After(400 * time.Millisecond):
		}
	}
}

// fiatLock is a best-effort cross-instance lock in Redis. Without Redis it allows
// the call; the row's forward-only status and the unique paid-order index still
// keep processing safe.
func fiatLock(key string) (func(), bool) {
	if redisClient.Client == nil {
		return func() {}, true
	}
	k := "fiat:lock:" + key
	ctx := context.Background()
	ok, err := redisClient.Client.SetNX(ctx, k, "1", 3*time.Minute).Result()
	if err != nil {
		return func() {}, true
	}
	if !ok {
		return func() {}, false
	}
	return func() { redisClient.Client.Del(context.Background(), k) }, true
}

func setFiatStatus(p *models.FiatPayment, status models.FiatPaymentStatus, fields map[string]any) error {
	if fields == nil {
		fields = map[string]any{}
	}
	fields["status"] = status
	fields["updated_at"] = time.Now().UTC()
	if err := db.DB.Model(&models.FiatPayment{}).Where("id = ?", p.ID).Updates(fields).Error; err != nil {
		return err
	}
	p.Status = status
	return nil
}

func recordFiatError(p *models.FiatPayment, err error) {
	p.Attempts++
	p.LastError = err.Error()
	db.DB.Model(&models.FiatPayment{}).Where("id = ?", p.ID).Updates(map[string]any{
		"attempts":   gorm.Expr("attempts + 1"),
		"last_error": truncate(err.Error(), 500),
		"updated_at": time.Now().UTC(),
	})
}

// refundFiatPayment refunds a charge that cannot be used (wrong amount, order gone,
// duplicate payment). Only valid before any SOL was sent.
func refundFiatPayment(ctx context.Context, p *models.FiatPayment, reason string) error {
	if err := paystackRefund(ctx, p.Reference); err != nil {
		recordFiatError(p, fmt.Errorf("refund failed (%s): %w", reason, err))
		return err
	}
	logging.Warn().Str("reference", p.Reference).Str("reason", reason).Msg("fiat: payment refunded")
	if err := setFiatStatus(p, models.FiatPaymentRefunded, map[string]any{"last_error": reason}); err != nil {
		return err
	}
	cancelUnpaidOrder(p.OrderID, "fiat.refund")
	return nil
}

// cancelUnpaidOrder cancels an order still waiting for payment once no payment can
// fund it any more, so it does not sit on "Awaiting payment" forever. It leaves the
// order alone while another payment for it is going through.
func cancelUnpaidOrder(orderID uuid.UUID, source string) {
	if fiatPaymentInProgress(orderID) {
		return
	}
	var order models.Order
	if err := db.DB.First(&order, "id = ?", orderID).Error; err != nil {
		return
	}
	if order.Status != models.OrderStatusPending && order.Status != models.OrderStatusPendingPayment {
		return
	}
	if err := fsm.TransitionOrder(db.DB, &order, models.OrderStatusCancelled, source, nil); err != nil {
		logging.Warn().Err(err).Str("order_id", orderID.String()).Msg("fiat: could not cancel unpaid order")
		return
	}
	terminateOrderSession(&order)
}

// processFiatPayment moves one payment forward as far as it can. Safe to call
// repeatedly and concurrently (webhook, browser verify, reconciler).
func processFiatPayment(ctx context.Context, reference string) (*models.FiatPayment, error) {
	unlock, locked := fiatLock("ref:" + reference)
	if !locked {
		return nil, errors.New("payment is being processed")
	}
	defer unlock()

	var p models.FiatPayment
	if err := db.DB.Where("reference = ?", reference).First(&p).Error; err != nil {
		return nil, fmt.Errorf("unknown payment reference: %w", err)
	}

	for {
		switch p.Status {
		case models.FiatPaymentActive, models.FiatPaymentFailed, models.FiatPaymentRefunded:
			return &p, nil
		}
		var order models.Order
		if err := db.DB.First(&order, "id = ?", p.OrderID).Error; err != nil {
			return &p, err
		}

		switch p.Status {
		case models.FiatPaymentQuoted:
			tx, err := paystackVerify(ctx, p.Reference)
			if err != nil {
				return &p, err
			}
			if tx.Status != "success" {
				return &p, errFiatNotPaidYet
			}
			if tx.Reference != p.Reference || tx.Amount != p.AmountMinor || !strings.EqualFold(tx.Currency, p.Currency) {
				_ = refundFiatPayment(ctx, &p, fmt.Sprintf("charge mismatch: got %d %s, quoted %d %s", tx.Amount, tx.Currency, p.AmountMinor, p.Currency))
				return &p, errors.New("payment did not match the quote and was refunded")
			}
			if order.Status != models.OrderStatusPending && order.Status != models.OrderStatusPendingPayment {
				_ = refundFiatPayment(ctx, &p, "order no longer awaiting payment: "+string(order.Status))
				return &p, errFiatOrderSettled
			}
			txID := tx.ID
			if err := setFiatStatus(&p, models.FiatPaymentPaid, map[string]any{"provider_tx_id": txID}); err != nil {
				// Unique paid-order index: another payment already backs this order.
				_ = refundFiatPayment(ctx, &p, "duplicate payment for order")
				return &p, errFiatOrderSettled
			}

		case models.FiatPaymentPaid:
			// One transaction: treasury -> managed wallet top-up + initialize_escrow,
			// treasury pays the fee. Its signature is recorded before sending, so a
			// retry checks that exact transaction and never funds twice.
			if p.FundingTx != "" {
				landed, err := waitForFiatFunding(ctx, &p)
				if err != nil {
					recordFiatError(&p, err)
					return &p, err
				}
				if !landed && p.FundingTx != "" {
					return &p, errFiatInProgress
				}
				continue // landed -> escrowed; dropped -> funding_tx cleared, re-sign below
			}
			buyer, err := loadManagedBuyer(p.UserID)
			if err != nil {
				recordFiatError(&p, err)
				return &p, err
			}
			params, err := managedEscrowParams(&order, buyer)
			if err != nil {
				recordFiatError(&p, err)
				return &p, err
			}
			if e := fiatFetchEscrow(ctx, params.EscrowPDA); e != nil {
				if !escrowOpenedForPayment(e, &p) {
					// An earlier plan with this provider holds the escrow address, so this
					// order can never open. Nothing was sent: give the money back.
					_ = refundFiatPayment(ctx, &p, "an earlier plan with this provider still holds the escrow")
					return &p, errFiatOrderSettled
				}
				if err := setFiatStatus(&p, models.FiatPaymentEscrowed, nil); err != nil {
					return &p, err
				}
				continue
			}
			total, err := managedEscrowTotal(ctx, &order)
			if err != nil {
				recordFiatError(&p, err)
				return &p, err
			}
			bal, err := fiatWalletBalance(ctx, buyer.address)
			if err != nil {
				recordFiatError(&p, fmt.Errorf("read managed wallet balance: %w", err))
				return &p, err
			}
			var fund uint64
			if bal < total {
				fund = total - bal
			}
			if fund > uint64(p.LamportsNeeded)+fiatMaxTopUpLamports {
				err := fmt.Errorf("wallet needs %d lamports, more than this payment covers; needs ops review", fund)
				recordFiatError(&p, err)
				return &p, err
			}
			tx, err := fiatBuildFundEscrowTx(ctx, fund, params)
			if err != nil {
				recordFiatError(&p, fmt.Errorf("build funding tx: %w", err))
				return &p, err
			}
			if err := buyer.signer.SignTransactionContext(ctx, tx); err != nil {
				recordFiatError(&p, fmt.Errorf("sign funding tx: %w", err))
				return &p, err
			}
			sig := tx.Signatures[0].String()
			now := time.Now().UTC()
			if err := setFiatStatus(&p, models.FiatPaymentPaid, map[string]any{
				"funding_tx": sig, "funding_sent_at": now, "lamports_funded": int64(fund),
			}); err != nil {
				return &p, err
			}
			p.FundingTx, p.FundingSentAt, p.LamportsFunded = sig, &now, int64(fund)
			if err := fiatSendSigned(ctx, tx); err != nil {
				recordFiatError(&p, fmt.Errorf("send funding tx: %w", err))
				// Stay recorded: the status check decides whether it landed.
			}

		case models.FiatPaymentFunded:
			buyer, err := loadManagedBuyer(p.UserID)
			if err != nil {
				recordFiatError(&p, err)
				return &p, err
			}
			if err := topUpManagedWallet(ctx, &p, &order, buyer); err != nil {
				recordFiatError(&p, err)
				return &p, err
			}
			escrowTx, err := openManagedEscrow(ctx, &order, buyer)
			if err != nil {
				recordFiatError(&p, fmt.Errorf("escrow: %w", err))
				return &p, err
			}
			if err := setFiatStatus(&p, models.FiatPaymentEscrowed, map[string]any{"escrow_tx": escrowTx}); err != nil {
				return &p, err
			}

		case models.FiatPaymentEscrowed:
			if order.Status == models.OrderStatusActive || order.Status == models.OrderStatusCompleted {
				if order.SessionID != nil {
					_ = marketplace.ActivateOrderSession(ctx, order.ID)
				}
			} else if _, _, problem := fiatConfirmEscrow(solana.WithConfirmedReads(ctx), &order, p.EscrowTx, "api.orders.pay_paystack", "paystack"); problem != nil {
				recordFiatError(&p, problem)
				return &p, problem
			}
			if err := setFiatStatus(&p, models.FiatPaymentActive, map[string]any{"last_error": ""}); err != nil {
				return &p, err
			}

		default:
			return &p, fmt.Errorf("unexpected fiat payment status %q", p.Status)
		}
	}
}

// RunFiatPaymentReconciler retries payments stuck mid-way (lost webhook, RPC blips,
// a closed browser) until ctx is cancelled.
func RunFiatPaymentReconciler(ctx context.Context) {
	if !fiatPaymentsEnabled() && !cashoutEnabled() {
		return
	}
	logging.Info().Msg("Fiat payment reconciler started")
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if fiatPaymentsEnabled() {
				reconcileFiatPayments(ctx)
			}
			if cashoutEnabled() {
				reconcileCashouts(ctx)
			}
		}
	}
}

func reconcileFiatPayments(ctx context.Context) {
	var rows []models.FiatPayment
	db.DB.Where(
		"(status IN ? AND updated_at < ?) OR (status = ? AND created_at < ?)",
		[]models.FiatPaymentStatus{models.FiatPaymentPaid, models.FiatPaymentFunded, models.FiatPaymentEscrowed},
		time.Now().Add(-30*time.Second),
		models.FiatPaymentQuoted, time.Now().Add(-2*time.Minute),
	).Order("created_at ASC").Limit(50).Find(&rows)

	for i := range rows {
		p := rows[i]
		if p.Status == models.FiatPaymentQuoted && time.Since(p.CreatedAt) > fiatCheckoutExpiry {
			expireFiatCheckout(ctx, &p)
			continue
		}
		if p.Attempts >= fiatMaxAttempts {
			giveUpFiatPayment(ctx, &p)
			continue
		}
		stepCtx, cancel := context.WithTimeout(ctx, 3*time.Minute)
		_, err := processFiatPayment(stepCtx, p.Reference)
		cancel()
		if err != nil && !errors.Is(err, errFiatNotPaidYet) && !errors.Is(err, errFiatInProgress) {
			logging.Warn().Err(err).Str("reference", p.Reference).Str("status", string(p.Status)).Msg("fiat reconciler: payment still incomplete")
		}
	}
}

// fiatCheckoutExpiry is how long an opened Paystack checkout may stay unpaid before
// the order is cancelled.
const fiatCheckoutExpiry = 30 * time.Minute

// expireFiatCheckout closes a checkout the buyer never paid. Paystack is asked one last
// time, so a late mobile money payment still goes through instead of being dropped.
func expireFiatCheckout(ctx context.Context, p *models.FiatPayment) {
	paid, err := closeUnpaidCheckout(ctx, p, "checkout not completed")
	if err != nil || paid {
		return
	}
	cancelUnpaidOrder(p.OrderID, "fiat.checkout_expired")
}

// closeUnpaidCheckout marks a quoted payment failed unless Paystack reports it paid,
// in which case processing is started and paid is true.
func closeUnpaidCheckout(ctx context.Context, p *models.FiatPayment, reason string) (paid bool, err error) {
	tx, err := paystackVerify(ctx, p.Reference)
	if err != nil {
		return false, err
	}
	if tx.Status == "success" {
		fiatProcessAsync(p.Reference)
		return true, nil
	}
	return false, setFiatStatus(p, models.FiatPaymentFailed, map[string]any{"last_error": reason})
}

// fiatProcessAsync finishes a payment in the background (a seam so tests can wait on it).
var fiatProcessAsync = func(ref string) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
		defer cancel()
		_, _ = processFiatPayment(ctx, ref)
	}()
}

// giveUpFiatPayment ends a payment that keeps failing. Before SOL was sent the
// customer is refunded by Paystack; after, the SOL stays in their managed wallet
// as balance they can spend with "Pay from balance".
func giveUpFiatPayment(ctx context.Context, p *models.FiatPayment) {
	if p.Status == models.FiatPaymentPaid && p.FundingTx == "" {
		_ = refundFiatPayment(ctx, p, "gave up after repeated failures: "+p.LastError)
		return
	}
	wasFunded := p.Status == models.FiatPaymentFunded
	_ = setFiatStatus(p, models.FiatPaymentFailed, nil)
	if wasFunded {
		// SOL reached the wallet but no escrow opened: it stays there as credit.
		cancelUnpaidOrder(p.OrderID, "fiat.give_up")
	}
	logging.Error(errors.New(p.LastError)).Str("reference", p.Reference).Str("order_id", p.OrderID.String()).
		Msg("ALERT: fiat payment failed after funding; SOL left in the buyer's managed wallet")
}
