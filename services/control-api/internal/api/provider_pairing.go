package api

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/middleware"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/ratelimiter"
	"gorm.io/gorm"
)

// Device pairing lets a provider node get credentials without a downloaded setup script
// (modelled on RFC 8628, the OAuth device flow):
//
//  1. The node calls POST /provider/pair/start and gets a long secret device_code (kept on
//     the node) and a short user_code (shown to the owner).
//  2. The owner opens the dashboard, sees which device is asking, and approves it
//     (GET /provider/pair/lookup, POST /provider/pair/decision).
//  3. The node polls POST /provider/pair/poll. The poll that first sees the approval
//     creates the provider token and node and returns the raw token, once.
//
// start and poll are public: the device has no credentials yet, and the device_code is
// the proof. lookup and decision run behind RequireAuth + RequireProviderRole, the same
// gate as POST /provider/tokens, so pairing can mint a token for exactly the people who
// could already mint one by hand. Provider-node tokens are denied these routes by
// middleware.providerTokenPathAllowed, so a leaked node token cannot mint more of them.
const (
	pairingTTL          = 10 * time.Minute
	pairingPollInterval = 5 * time.Second
	// pairingMaxPerIPPerHour is a coarse abuse backstop on rows one client address can
	// create. It is kept generous on purpose: behind Cloudflare, c.ClientIP() is an edge
	// address that many unrelated providers share, and onboarding a node starts one or two
	// pairings, so a tight cap would lock out innocent users long before it stopped anyone.
	pairingMaxPerIPPerHour = 60
	// pairingPurgeAfter is how long past expiry a row is kept before it is deleted.
	pairingPurgeAfter = 24 * time.Hour
	// pairingMaxBodyBytes caps every pairing request body. The largest legitimate one is a
	// start with four short text fields; start and poll are unauthenticated, and the
	// control API has no global body limit (the one in main_secure.go is never built).
	pairingMaxBodyBytes = 4 << 10

	// pairedTokenTTL is how long a token minted by pairing stays valid. Zero means it never
	// expires: a paired node runs unattended, so a key that lapsed would silently take it
	// offline. The owner can revoke it from the Tokens page at any time.
	pairedTokenTTL time.Duration = 0

	// Vowel-free and without look-alikes (no 0/O, 1/I), so a code cannot spell a word and
	// is easy to read aloud. 20^8 is about 2.6e10 codes.
	pairingUserCodeAlphabet = "BCDFGHJKLMNPQRSTVWXZ"
	pairingUserCodeLen      = 8
	pairingDeviceCodeBytes  = 32
)

var errPairingNotRedeemable = errors.New("pairing is not redeemable")

// RegisterProviderPairingPublicRoutes registers the routes the node itself calls.
// They are unauthenticated by design; see the package comment above.
func RegisterProviderPairingPublicRoutes(rg *gin.RouterGroup) {
	rg.POST("/provider/pair/start", pairingLimiter("start", 20, false), pairingBodyLimit, startProviderPairing)
	rg.POST("/provider/pair/poll", pairingLimiter("poll", 300, false), pairingBodyLimit, pollProviderPairing)
}

// RegisterProviderPairingRoutes registers the routes the signed-in owner calls. Mount
// them on the provider-role group.
func RegisterProviderPairingRoutes(rg *gin.RouterGroup) {
	rg.GET("/provider/pair/lookup", pairingLimiter("lookup", 30, true), lookupProviderPairing)
	rg.POST("/provider/pair/decision", pairingLimiter("decision", 30, true), pairingBodyLimit, decideProviderPairing)
}

// pairingBodyLimit makes a body over pairingMaxBodyBytes fail to decode, which each handler
// already answers with 400 and without creating or changing anything.
var pairingBodyLimit = middleware.RequestSizeLimiter(pairingMaxBodyBytes).Handle

// pairingLimiter is a per-minute limit private to one pairing route.
//
// It is built from the ratelimiter package directly rather than
// middleware.SlidingWindowRateLimit because that helper keys only by caller, with no route
// in the key. Used on several routes it would make them share one budget, and the
// in-memory fallback (no Redis) fixes a bucket's size from whichever route reaches the key
// first, so a node's own polling could starve its start, or the reverse.
//
// Owner routes are keyed by user id. Public routes can only use the client address, which
// behind Cloudflare is a shared edge address (see pairingMaxPerIPPerHour), so the limits
// are generous and the progressive-ban ladder is off: a ban on a shared address would lock
// out innocent providers. The device_code, not the limiter, is what protects a pairing.
func pairingLimiter(route string, perMinute int, byUser bool) gin.HandlerFunc {
	return ratelimiter.AdvancedRateLimit(ratelimiter.AdvancedRateLimitConfig{
		Algorithm: ratelimiter.SlidingWindow,
		Limit:     perMinute,
		Window:    time.Minute,
		KeyFunc: func(c *gin.Context) string {
			if byUser {
				if uid, ok := GetUserID(c); ok {
					return "provider_pair:" + route + ":user:" + uid.String()
				}
			}
			return "provider_pair:" + route + ":ip:" + c.ClientIP()
		},
	})
}

type pairingStartRequest struct {
	DeviceName    string `json:"device_name"`
	Platform      string `json:"platform"`
	Arch          string `json:"arch"`
	ClientVersion string `json:"client_version"`
}

func startProviderPairing(c *gin.Context) {
	c.Header("Cache-Control", "no-store")

	var req pairingStartRequest
	// The body is optional, but if there is one it must be valid JSON.
	if err := c.ShouldBindJSON(&req); err != nil && !errors.Is(err, io.EOF) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body", "code": "invalid_request"})
		return
	}

	now := time.Now().UTC()
	ip := c.ClientIP()

	// Best-effort housekeeping; the expires_at index keeps this a short range delete.
	_ = db.DB.Where("expires_at < ?", now.Add(-pairingPurgeAfter)).Delete(&models.ProviderPairing{}).Error

	var recent int64
	if err := db.DB.Model(&models.ProviderPairing{}).
		Where("created_ip = ? AND created_at > ?", ip, now.Add(-time.Hour)).
		Count(&recent).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to start pairing"})
		return
	}
	if recent >= pairingMaxPerIPPerHour {
		c.JSON(http.StatusTooManyRequests, gin.H{
			"error": "too many pairing requests from this address; try again later",
			"code":  "pairing_rate_limited",
		})
		return
	}

	deviceName := cleanPairingText(req.DeviceName, 100)
	if deviceName == "" {
		deviceName = "Unnamed device"
	}

	// A user_code collision is astronomically unlikely, but the unique index is the
	// authority, so retry a few times rather than fail the request.
	for attempt := 0; attempt < 5; attempt++ {
		userCode, err := newPairingUserCode()
		if err != nil {
			break
		}
		deviceCode, deviceHash, err := newPairingDeviceCode()
		if err != nil {
			break
		}
		p := models.ProviderPairing{
			DeviceCodeHash: deviceHash,
			UserCode:       userCode,
			Status:         models.ProviderPairingPending,
			DeviceName:     deviceName,
			Platform:       cleanPairingText(req.Platform, 32),
			Arch:           cleanPairingText(req.Arch, 32),
			ClientVersion:  cleanPairingText(req.ClientVersion, 32),
			CreatedIP:      ip,
			NextPollAt:     now,
			ExpiresAt:      now.Add(pairingTTL),
		}
		if err := db.DB.Create(&p).Error; err != nil {
			if isUniqueViolation(err) {
				continue
			}
			logging.Warn().Err(err).Msg("provider pairing: create failed")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to start pairing"})
			return
		}

		verifyURL := pairingVerificationURL()
		c.JSON(http.StatusCreated, gin.H{
			"device_code":               deviceCode,
			"user_code":                 formatPairingUserCode(userCode),
			"verification_uri":          verifyURL,
			"verification_uri_complete": verifyURL + "?code=" + formatPairingUserCode(userCode),
			"expires_in":                int(pairingTTL.Seconds()),
			"interval":                  int(pairingPollInterval.Seconds()),
		})
		return
	}
	c.JSON(http.StatusServiceUnavailable, gin.H{"error": "could not allocate a pairing code; retry"})
}

type pairingPollRequest struct {
	DeviceCode string `json:"device_code" binding:"required"`
}

func pollProviderPairing(c *gin.Context) {
	c.Header("Cache-Control", "no-store")

	var req pairingPollRequest
	if err := c.ShouldBindJSON(&req); err != nil || !validPairingDeviceCode(req.DeviceCode) {
		c.JSON(http.StatusBadRequest, gin.H{"status": "invalid", "error": "invalid device_code"})
		return
	}

	var p models.ProviderPairing
	if err := db.DB.Where("device_code_hash = ?", hashPairingDeviceCode(req.DeviceCode)).
		First(&p).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusBadRequest, gin.H{"status": "invalid", "error": "unknown device_code"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to check pairing"})
		return
	}

	now := time.Now().UTC()
	switch {
	case p.Status == models.ProviderPairingDenied:
		c.JSON(http.StatusForbidden, gin.H{"status": "denied"})
		return
	case p.Status == models.ProviderPairingRedeemed:
		c.JSON(http.StatusGone, gin.H{"status": "redeemed"})
		return
	case !now.Before(p.ExpiresAt):
		c.JSON(http.StatusGone, gin.H{"status": "expired"})
		return
	case p.Status == models.ProviderPairingPending:
		if now.Before(p.NextPollAt) {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"status":   "slow_down",
				"interval": int(pairingPollInterval.Seconds()),
			})
			return
		}
		_ = db.DB.Model(&models.ProviderPairing{}).Where("id = ?", p.ID).
			Update("next_poll_at", now.Add(pairingPollInterval)).Error
		c.JSON(http.StatusOK, gin.H{
			"status":   "pending",
			"interval": int(pairingPollInterval.Seconds()),
		})
		return
	}

	// Approved: the owner said yes. Redeem it exactly once.
	apiKey, nodeID, err := redeemProviderPairing(c, p, now)
	if err != nil {
		if errors.Is(err, errPairingNotRedeemable) {
			// Lost a race with another poll of the same device_code, or it just expired.
			c.JSON(http.StatusGone, gin.H{"status": "redeemed"})
			return
		}
		logging.Warn().Err(err).Str("pairing_id", p.ID.String()).Msg("provider pairing: redeem failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to complete pairing"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"status":  "approved",
		"api_key": apiKey, // the only time the raw token is ever returned
		"node_id": nodeID.String(),
	})
}

// redeemProviderPairing turns an approved pairing into a provider token and node, inside
// one transaction. The conditional UPDATE is the single-use guard: of any number of
// concurrent polls, exactly one sees RowsAffected == 1 and mints credentials.
func redeemProviderPairing(c *gin.Context, p models.ProviderPairing, now time.Time) (string, uuid.UUID, error) {
	if p.UserID == nil || *p.UserID == uuid.Nil {
		return "", uuid.Nil, fmt.Errorf("approved pairing %s has no approver", p.ID)
	}
	userID := *p.UserID

	rawToken, err := models.GenerateRawToken()
	if err != nil {
		return "", uuid.Nil, err
	}
	var expiresAt *time.Time
	if pairedTokenTTL > 0 {
		exp := now.Add(pairedTokenTTL)
		expiresAt = &exp
	}
	nodeName := p.DeviceName
	if nodeName == "" {
		nodeName = "Provider node"
	}

	var nodeID uuid.UUID
	err = db.DB.Transaction(func(tx *gorm.DB) error {
		res := tx.Model(&models.ProviderPairing{}).
			Where("id = ? AND status = ? AND expires_at > ?", p.ID, models.ProviderPairingApproved, now).
			Updates(map[string]interface{}{
				"status":      models.ProviderPairingRedeemed,
				"redeemed_at": now,
				"updated_at":  now,
			})
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected != 1 {
			return errPairingNotRedeemable
		}

		token := models.ProviderToken{
			UserID:    userID,
			Token:     models.HashToken(rawToken),
			Name:      clipRunes("Paired: "+nodeName, 100),
			IsActive:  true,
			ExpiresAt: expiresAt,
		}
		if err := tx.Create(&token).Error; err != nil {
			return err
		}

		// Same shape as createProviderNodeForToken, but inside the transaction and
		// failing loudly: a half-created pairing must roll back, not leave a token with
		// no node.
		pn := models.ProviderNode{
			ID:            uuid.New(),
			UserID:        userID,
			Name:          nodeName,
			Status:        models.NodeOffline,
			GatewayNodeID: providerGatewayNodeID(userID),
			IsHealthy:     false,
		}
		if err := tx.Create(&pn).Error; err != nil {
			return err
		}
		reg := models.ProviderNodeRegistration{
			UserID:    userID,
			TokenID:   token.ID,
			NodeID:    pn.ID,
			IPAddress: p.CreatedIP,
			FirstSeen: now,
			LastSeen:  now,
			IsActive:  true,
		}
		if err := tx.Create(&reg).Error; err != nil {
			return err
		}
		nodeID = pn.ID
		return tx.Model(&models.ProviderPairing{}).Where("id = ?", p.ID).
			Updates(map[string]interface{}{"token_id": token.ID, "node_id": pn.ID}).Error
	})
	if err != nil {
		return "", uuid.Nil, err
	}

	ensureNodePayoutWallet(nodeID, userID)
	RecordAuditLog(c, models.AuditPairingRedeemed, models.AuditSeverityInfo, &userID,
		"provider_pairing", p.ID.String(),
		fmt.Sprintf("Device %q redeemed an approved pairing and received node %s", nodeName, nodeID), true)
	return rawToken, nodeID, nil
}

func lookupProviderPairing(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if _, ok := GetUserID(c); !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	p, ok := findPendingPairing(c.Query("code"), time.Now().UTC())
	if !ok {
		pairingNotFound(c)
		return
	}
	// Deliberately no address-derived fields ("requested from", "same network"). In
	// production control-api sits behind Cloudflare and Caddy and sees an edge address
	// shared by unrelated users, and one person's CLI and browser can arrive through
	// different edges, so such a hint would be wrong in both directions. The owner
	// decides from what only the real device can show: its name, system, and code.
	c.JSON(http.StatusOK, gin.H{
		"user_code":      formatPairingUserCode(p.UserCode),
		"device_name":    p.DeviceName,
		"platform":       p.Platform,
		"arch":           p.Arch,
		"client_version": p.ClientVersion,
		"created_at":     p.CreatedAt,
		"expires_at":     p.ExpiresAt,
	})
}

type pairingDecisionRequest struct {
	Code     string `json:"code" binding:"required"`
	Decision string `json:"decision" binding:"required"` // "approve" or "deny"
}

func decideProviderPairing(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	var req pairingDecisionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "code and decision are required"})
		return
	}
	var (
		newStatus string
		event     models.AuditEventType
	)
	switch strings.ToLower(strings.TrimSpace(req.Decision)) {
	case "approve":
		newStatus, event = models.ProviderPairingApproved, models.AuditPairingApproved
	case "deny":
		newStatus, event = models.ProviderPairingDenied, models.AuditPairingDenied
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": `decision must be "approve" or "deny"`})
		return
	}

	now := time.Now().UTC()
	p, found := findPendingPairing(req.Code, now)
	if !found {
		pairingNotFound(c)
		return
	}

	applied, err := applyPairingDecision(p, newStatus, userID, now)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to record decision"})
		return
	}
	if !applied {
		pairingNotFound(c)
		return
	}

	RecordAuditLog(c, event, models.AuditSeverityInfo, &userID, "provider_pairing", p.ID.String(),
		fmt.Sprintf("%s pairing for device %q (%s) requested from %s", newStatus, p.DeviceName, p.Platform, p.CreatedIP), true)
	c.JSON(http.StatusOK, gin.H{"status": newStatus})
}

// applyPairingDecision records the owner's decision and reports whether it took effect.
// The UPDATE re-checks status and expiry itself: two owners (or a double click) who both
// read the row as pending cannot both decide it, and only the first one lands.
func applyPairingDecision(p models.ProviderPairing, newStatus string, userID uuid.UUID, now time.Time) (bool, error) {
	updates := map[string]interface{}{
		"status":     newStatus,
		"user_id":    userID,
		"updated_at": now,
	}
	if newStatus == models.ProviderPairingApproved {
		updates["approved_at"] = now
	}
	res := db.DB.Model(&models.ProviderPairing{}).
		Where("id = ? AND status = ? AND expires_at > ?", p.ID, models.ProviderPairingPending, now).
		Updates(updates)
	return res.RowsAffected == 1, res.Error
}

// findPendingPairing returns the live, undecided pairing for a user-typed code. An
// unknown, expired or already-decided code all look the same to the caller.
func findPendingPairing(rawCode string, now time.Time) (models.ProviderPairing, bool) {
	var p models.ProviderPairing
	code, ok := normalizePairingUserCode(rawCode)
	if !ok {
		return p, false
	}
	if err := db.DB.Where("user_code = ? AND status = ? AND expires_at > ?",
		code, models.ProviderPairingPending, now).First(&p).Error; err != nil {
		return p, false
	}
	return p, true
}

func pairingNotFound(c *gin.Context) {
	c.JSON(http.StatusNotFound, gin.H{
		"error": "pairing request not found or expired",
		"code":  "pairing_not_found",
	})
}

// pairingVerificationURL is where the owner approves a request: the dashboard page.
func pairingVerificationURL() string {
	base := strings.TrimRight(strings.TrimSpace(os.Getenv("FRONTEND_URL")), "/")
	if base == "" {
		base = "http://localhost:3000" // same fallback as config.Load
	}
	return base + "/dashboard/provider/pair"
}

func newPairingDeviceCode() (raw, hash string, err error) {
	b := make([]byte, pairingDeviceCodeBytes)
	if _, err := rand.Read(b); err != nil {
		return "", "", err
	}
	raw = hex.EncodeToString(b)
	return raw, hashPairingDeviceCode(raw), nil
}

// hashPairingDeviceCode is plain SHA-256: the input is 256 random bits, so there is
// nothing to brute-force and no need for a slow or keyed hash.
func hashPairingDeviceCode(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func validPairingDeviceCode(s string) bool {
	if len(s) != pairingDeviceCodeBytes*2 {
		return false
	}
	for _, r := range s {
		if (r < '0' || r > '9') && (r < 'a' || r > 'f') {
			return false
		}
	}
	return true
}

func newPairingUserCode() (string, error) {
	// Rejection sampling: 256 is not a multiple of 20, so a bare modulo would favour the
	// first 16 letters.
	limit := 256 - (256 % len(pairingUserCodeAlphabet))
	out := make([]byte, 0, pairingUserCodeLen)
	buf := make([]byte, pairingUserCodeLen*2)
	for len(out) < pairingUserCodeLen {
		if _, err := rand.Read(buf); err != nil {
			return "", err
		}
		for _, b := range buf {
			if int(b) >= limit {
				continue
			}
			out = append(out, pairingUserCodeAlphabet[int(b)%len(pairingUserCodeAlphabet)])
			if len(out) == pairingUserCodeLen {
				break
			}
		}
	}
	return string(out), nil
}

// formatPairingUserCode shows BCDFGHJK as BCDF-GHJK.
func formatPairingUserCode(code string) string {
	if len(code) != pairingUserCodeLen {
		return code
	}
	return code[:pairingUserCodeLen/2] + "-" + code[pairingUserCodeLen/2:]
}

// normalizePairingUserCode accepts what a person types: any case, with or without the
// dash or spaces. It returns the stored form, or false if the input cannot be a code.
func normalizePairingUserCode(input string) (string, bool) {
	code := strings.ToUpper(strings.NewReplacer("-", "", " ", "").Replace(strings.TrimSpace(input)))
	if len(code) != pairingUserCodeLen {
		return "", false
	}
	for _, r := range code {
		if !strings.ContainsRune(pairingUserCodeAlphabet, r) {
			return "", false
		}
	}
	return code, true
}

// cleanPairingText makes untrusted device metadata safe to store and show: valid UTF-8,
// no control characters (including newlines), collapsed whitespace, bounded length.
func cleanPairingText(s string, maxRunes int) string {
	s = strings.ToValidUTF8(s, "")
	s = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return ' '
		}
		return r
	}, s)
	return clipRunes(strings.Join(strings.Fields(s), " "), maxRunes)
}

func clipRunes(s string, maxRunes int) string {
	if utf8.RuneCountInString(s) <= maxRunes {
		return s
	}
	return string([]rune(s)[:maxRunes])
}

// isUniqueViolation reports a Postgres unique_violation (SQLSTATE 23505). It matches the
// text because the driver's typed error lives in a package this module only imports
// indirectly.
func isUniqueViolation(err error) bool {
	return err != nil && strings.Contains(err.Error(), "SQLSTATE 23505")
}
