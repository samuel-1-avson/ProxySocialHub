package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/crypto"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/middleware"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
	"gorm.io/gorm"
)

// ── fixtures ─────────────────────────────────────────────────────────────────

// pairingTestAuth stands in for RequireAuth: the user and role come from headers, and
// X-Test-Auth-Type lets a test present itself as a provider-node token.
func pairingTestAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		raw := c.GetHeader("X-Test-User")
		uid, err := uuid.Parse(raw)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
			return
		}
		c.Set("user_id", uid)
		c.Set("userRole", c.GetHeader("X-Test-Role"))
		if at := c.GetHeader("X-Test-Auth-Type"); at != "" {
			c.Set("auth_type", at)
		}
		c.Next()
	}
}

// pairingEnv wires the same middleware order main.go uses for these routes.
type pairingEnv struct {
	t      *testing.T
	r      *gin.Engine
	owner  *models.User // a provider
	buyer  *models.User // a non-provider
	ip     string       // unique per test so the per-address limits never interact
	secret string
}

var pairingIPCounter atomic.Int32

func newPairingEnv(t *testing.T) *pairingEnv {
	t.Helper()
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "provider_pairings", "provider_node_registrations", "provider_tokens", "provider_nodes", "audit_logs", "users")

	t.Setenv("JWT_SECRET", testJWTSecret)
	t.Setenv("TOKEN_HMAC_SECRET", testTokenHMACSecret)
	t.Setenv("FRONTEND_URL", "https://app.example.test/")
	models.TokenHashFn = crypto.NewTokenHashFn(testTokenHMACSecret)

	r := setupTestRouter()
	v1 := r.Group("/v1")
	RegisterProviderPairingPublicRoutes(v1)
	v1.POST("/provider/gateway-token", issueGatewayToken) // the consumer a paired node calls next

	owner := v1.Group("/")
	owner.Use(pairingTestAuth())
	owner.Use(middleware.RestrictProviderToken())
	owner.Use(middleware.RequireProviderRole())
	RegisterProviderPairingRoutes(owner)

	return &pairingEnv{
		t:     t,
		r:     r,
		owner: testutil.CreateTestUser(t, testutil.UniqueEmail("pair-owner"), "provider"),
		buyer: testutil.CreateTestUser(t, testutil.UniqueEmail("pair-buyer"), "buyer"),
		ip:    fmt.Sprintf("198.51.100.%d", pairingIPCounter.Add(1)),
	}
}

func (e *pairingEnv) do(method, path string, body interface{}, headers map[string]string) *httptest.ResponseRecorder {
	e.t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			e.t.Fatalf("encode body: %v", err)
		}
	}
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Forwarded-For", e.ip)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	e.r.ServeHTTP(w, req)
	return w
}

func (e *pairingEnv) asOwner() map[string]string {
	return map[string]string{"X-Test-User": e.owner.ID.String(), "X-Test-Role": "provider"}
}

func (e *pairingEnv) asBuyer() map[string]string {
	return map[string]string{"X-Test-User": e.buyer.ID.String(), "X-Test-Role": "buyer"}
}

type startedPairing struct {
	DeviceCode string `json:"device_code"`
	UserCode   string `json:"user_code"`
	VerifyURI  string `json:"verification_uri"`
	VerifyFull string `json:"verification_uri_complete"`
	ExpiresIn  int    `json:"expires_in"`
	Interval   int    `json:"interval"`
}

func (e *pairingEnv) start() startedPairing {
	e.t.Helper()
	w := e.do(http.MethodPost, "/v1/provider/pair/start", map[string]string{
		"device_name": "Jane's Laptop", "platform": "windows", "arch": "x86_64", "client_version": "1.2.3",
	}, nil)
	if w.Code != http.StatusCreated {
		e.t.Fatalf("start: status %d body %s", w.Code, w.Body.String())
	}
	var s startedPairing
	if err := json.Unmarshal(w.Body.Bytes(), &s); err != nil {
		e.t.Fatalf("start decode: %v", err)
	}
	return s
}

func (e *pairingEnv) decide(code, decision string, headers map[string]string) *httptest.ResponseRecorder {
	return e.do(http.MethodPost, "/v1/provider/pair/decision",
		map[string]string{"code": code, "decision": decision}, headers)
}

func (e *pairingEnv) poll(deviceCode string) *httptest.ResponseRecorder {
	return e.do(http.MethodPost, "/v1/provider/pair/poll", map[string]string{"device_code": deviceCode}, nil)
}

// allowNextPoll clears the poll throttle so a test can poll again immediately.
func (e *pairingEnv) allowNextPoll(deviceCode string) {
	e.t.Helper()
	if err := db.DB.Model(&models.ProviderPairing{}).
		Where("device_code_hash = ?", hashPairingDeviceCode(deviceCode)).
		Update("next_poll_at", time.Now().Add(-time.Second)).Error; err != nil {
		e.t.Fatalf("allowNextPoll: %v", err)
	}
}

func (e *pairingEnv) row(deviceCode string) models.ProviderPairing {
	e.t.Helper()
	var p models.ProviderPairing
	if err := db.DB.Where("device_code_hash = ?", hashPairingDeviceCode(deviceCode)).First(&p).Error; err != nil {
		e.t.Fatalf("load pairing row: %v", err)
	}
	return p
}

func (e *pairingEnv) pairedTokenCount() int64 {
	e.t.Helper()
	var n int64
	if err := db.DB.Model(&models.ProviderToken{}).Where("name LIKE ?", "Paired:%").Count(&n).Error; err != nil {
		e.t.Fatalf("count tokens: %v", err)
	}
	return n
}

func decodeMap(t *testing.T, w *httptest.ResponseRecorder) map[string]interface{} {
	t.Helper()
	var m map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &m); err != nil {
		t.Fatalf("decode %q: %v", w.Body.String(), err)
	}
	return m
}

// ── the flow ─────────────────────────────────────────────────────────────────

// The whole sequence a node and its owner walk through, ending with the minted token
// being accepted by the real gateway-token exchange the node calls next.
func TestProviderPairing_HappyPath(t *testing.T) {
	e := newPairingEnv(t)
	s := e.start()

	if s.ExpiresIn != 600 || s.Interval != 5 {
		t.Errorf("expires_in/interval = %d/%d, want 600/5", s.ExpiresIn, s.Interval)
	}
	if s.VerifyURI != "https://app.example.test/dashboard/provider/pair" {
		t.Errorf("verification_uri = %q", s.VerifyURI)
	}
	if s.VerifyFull != s.VerifyURI+"?code="+s.UserCode {
		t.Errorf("verification_uri_complete = %q", s.VerifyFull)
	}
	if len(s.UserCode) != 9 || s.UserCode[4] != '-' {
		t.Errorf("user_code %q should look like BCDF-GHJK", s.UserCode)
	}

	// Nothing to hand over before the owner decides.
	if w := e.poll(s.DeviceCode); w.Code != http.StatusOK || decodeMap(t, w)["status"] != "pending" {
		t.Fatalf("poll before approval: %d %s", w.Code, w.Body.String())
	}

	// The owner sees who is asking.
	w := e.do(http.MethodGet, "/v1/provider/pair/lookup?code="+strings.ToLower(s.UserCode), nil, e.asOwner())
	if w.Code != http.StatusOK {
		t.Fatalf("lookup: %d %s", w.Code, w.Body.String())
	}
	info := decodeMap(t, w)
	if info["device_name"] != "Jane's Laptop" || info["platform"] != "windows" || info["arch"] != "x86_64" {
		t.Errorf("lookup info = %v", info)
	}
	if _, leaked := info["device_code"]; leaked {
		t.Error("lookup must never return the device code")
	}
	// Behind Cloudflare the address we see is a shared edge, so an address-derived hint would
	// mislead in both directions. Keep it out of the response (see lookupProviderPairing).
	for _, k := range []string{"requested_from", "same_network", "created_ip"} {
		if _, has := info[k]; has {
			t.Errorf("lookup exposes %q: the client address is not reliable behind Cloudflare", k)
		}
	}

	if w := e.decide(s.UserCode, "approve", e.asOwner()); w.Code != http.StatusOK {
		t.Fatalf("approve: %d %s", w.Code, w.Body.String())
	}

	e.allowNextPoll(s.DeviceCode)
	w = e.poll(s.DeviceCode)
	if w.Code != http.StatusOK {
		t.Fatalf("poll after approval: %d %s", w.Code, w.Body.String())
	}
	got := decodeMap(t, w)
	apiKey, _ := got["api_key"].(string)
	nodeID, _ := got["node_id"].(string)
	if got["status"] != "approved" || len(apiKey) != 64 || nodeID == "" {
		t.Fatalf("redeem response = %v", got)
	}

	// Stored token is the keyed hash, never the raw value, owned by the approver, and
	// does not expire (see pairedTokenTTL).
	var token models.ProviderToken
	if err := db.DB.Where("token = ?", models.HashToken(apiKey)).First(&token).Error; err != nil {
		t.Fatalf("minted token not stored under its hash: %v", err)
	}
	if token.Token == apiKey || token.UserID != e.owner.ID || !token.IsActive || token.ExpiresAt != nil {
		t.Errorf("token row = %+v", token)
	}
	if token.Name != "Paired: Jane's Laptop" {
		t.Errorf("token name = %q", token.Name)
	}

	// A node named after the device, bound to the token.
	var pn models.ProviderNode
	if err := db.DB.Where("id = ?", nodeID).First(&pn).Error; err != nil {
		t.Fatalf("node not created: %v", err)
	}
	if pn.UserID != e.owner.ID || pn.Name != "Jane's Laptop" {
		t.Errorf("node = %+v", pn)
	}
	// Pairing cannot know the node's egress IP before its first real heartbeat.
	// Preserve unknown as SQL NULL: an empty inet value fails on production
	// PostgreSQL, and a test callback used to hide that failure with an invented IP.
	var unknownIP bool
	if err := db.DB.Raw("SELECT ip_address IS NULL FROM provider_nodes WHERE id = ?", pn.ID).Scan(&unknownIP).Error; err != nil {
		t.Fatalf("read paired node IP: %v", err)
	}
	if !unknownIP || pn.IPAddress != "" || pn.Status != models.NodeOffline || pn.IsHealthy {
		t.Error("an unconnected paired node must have an unknown IP and remain offline/unhealthy")
	}
	var reg models.ProviderNodeRegistration
	if err := db.DB.Where("token_id = ? AND is_active = ?", token.ID, true).First(&reg).Error; err != nil {
		t.Fatalf("registration missing: %v", err)
	}
	if reg.NodeID.String() != nodeID {
		t.Errorf("registration node = %s, want %s", reg.NodeID, nodeID)
	}

	row := e.row(s.DeviceCode)
	if row.Status != models.ProviderPairingRedeemed || row.TokenID == nil || *row.TokenID != token.ID ||
		row.NodeID == nil || row.NodeID.String() != nodeID || row.RedeemedAt == nil {
		t.Errorf("pairing row after redeem = %+v", row)
	}
	// No secret of any kind is parked in the pairing row.
	if dump := fmt.Sprintf("%+v", row); strings.Contains(dump, apiKey) || strings.Contains(dump, s.DeviceCode) {
		t.Error("pairing row contains a raw secret")
	}

	// The consumer: the node's very next call, exchanging its key for a gateway JWT.
	gw := e.do(http.MethodPost, "/v1/provider/gateway-token", map[string]string{"token": apiKey}, nil)
	if gw.Code != http.StatusOK {
		t.Fatalf("gateway-token with paired key: %d %s", gw.Code, gw.Body.String())
	}
	if decodeMap(t, gw)["user_id"] != e.owner.ID.String() {
		t.Errorf("gateway token issued for the wrong user: %s", gw.Body.String())
	}
}

func TestProviderPairing_PollIsThrottledWhilePending(t *testing.T) {
	e := newPairingEnv(t)
	s := e.start()

	if w := e.poll(s.DeviceCode); w.Code != http.StatusOK {
		t.Fatalf("first poll: %d %s", w.Code, w.Body.String())
	}
	w := e.poll(s.DeviceCode)
	if w.Code != http.StatusTooManyRequests || decodeMap(t, w)["status"] != "slow_down" {
		t.Fatalf("immediate second poll: %d %s, want 429 slow_down", w.Code, w.Body.String())
	}
	e.allowNextPoll(s.DeviceCode)
	if w := e.poll(s.DeviceCode); w.Code != http.StatusOK {
		t.Fatalf("poll after the interval: %d %s", w.Code, w.Body.String())
	}
}

// The raw token is shown once. A second poll, from the same device or anyone who copied
// its code, must not mint another.
func TestProviderPairing_DeviceCodeIsSingleUse(t *testing.T) {
	e := newPairingEnv(t)
	s := e.start()
	e.decide(s.UserCode, "approve", e.asOwner())

	if w := e.poll(s.DeviceCode); w.Code != http.StatusOK {
		t.Fatalf("first redeem: %d %s", w.Code, w.Body.String())
	}
	w := e.poll(s.DeviceCode)
	if w.Code != http.StatusGone || decodeMap(t, w)["status"] != "redeemed" {
		t.Errorf("second redeem: %d %s, want 410 redeemed", w.Code, w.Body.String())
	}
	if _, has := decodeMap(t, w)["api_key"]; has {
		t.Error("a redeemed pairing must never return a key again")
	}
	if n := e.pairedTokenCount(); n != 1 {
		t.Errorf("tokens minted = %d, want 1", n)
	}
}

// The conditional UPDATEs are what make a decision or a redemption single-shot when two
// requests have both already read the row in its earlier state. The handler's own status
// check catches every sequential repeat first, and HTTP-level races rarely line up both
// requests inside that window, so these hand the second caller a stale snapshot instead.
// (Verified by mutation: dropping the status/expiry clause from either UPDATE fails them.)
func redeemWithStaleSnapshot(t *testing.T, stale models.ProviderPairing) error {
	t.Helper()
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/", nil)
	_, _, err := redeemProviderPairing(c, stale, time.Now().UTC())
	return err
}

func TestProviderPairing_StaleSnapshotCannotRedeemTwice(t *testing.T) {
	e := newPairingEnv(t)
	s := e.start()
	e.decide(s.UserCode, "approve", e.asOwner())
	stale := e.row(s.DeviceCode) // what two racing polls would both have read

	if err := redeemWithStaleSnapshot(t, stale); err != nil {
		t.Fatalf("first redeem: %v", err)
	}
	if err := redeemWithStaleSnapshot(t, stale); !errors.Is(err, errPairingNotRedeemable) {
		t.Errorf("second redeem from the same snapshot = %v, want errPairingNotRedeemable", err)
	}
	if n := e.pairedTokenCount(); n != 1 {
		t.Errorf("tokens minted = %d, want 1", n)
	}
	var nodes int64
	db.DB.Model(&models.ProviderNode{}).Where("user_id = ?", e.owner.ID).Count(&nodes)
	if nodes != 1 {
		t.Errorf("nodes created = %d, want 1", nodes)
	}
}

func TestProviderPairing_StaleSnapshotCannotRedeemAfterExpiry(t *testing.T) {
	e := newPairingEnv(t)
	s := e.start()
	e.decide(s.UserCode, "approve", e.asOwner())
	stale := e.row(s.DeviceCode) // still looks unexpired
	db.DB.Model(&models.ProviderPairing{}).Where("id = ?", stale.ID).Update("expires_at", time.Now().Add(-time.Minute))

	if err := redeemWithStaleSnapshot(t, stale); !errors.Is(err, errPairingNotRedeemable) {
		t.Errorf("redeem after expiry = %v, want errPairingNotRedeemable", err)
	}
	if n := e.pairedTokenCount(); n != 0 {
		t.Errorf("tokens minted = %d, want 0", n)
	}
}

func TestProviderPairing_StaleSnapshotCannotDecideTwice(t *testing.T) {
	e := newPairingEnv(t)
	s := e.start()
	stale := e.row(s.DeviceCode) // both owners' requests would have read it as pending
	now := time.Now().UTC()

	if ok, err := applyPairingDecision(stale, models.ProviderPairingApproved, e.owner.ID, now); err != nil || !ok {
		t.Fatalf("first decision = %v, %v; want applied", ok, err)
	}
	if ok, err := applyPairingDecision(stale, models.ProviderPairingDenied, e.buyer.ID, now); err != nil || ok {
		t.Errorf("second decision from the same snapshot = %v, %v; want not applied", ok, err)
	}
	row := e.row(s.DeviceCode)
	if row.Status != models.ProviderPairingApproved || row.UserID == nil || *row.UserID != e.owner.ID {
		t.Errorf("row = status %q user %v; the first decision must stand", row.Status, row.UserID)
	}

	// And one that lapsed between the read and the write.
	s2 := e.start()
	stale2 := e.row(s2.DeviceCode)
	db.DB.Model(&models.ProviderPairing{}).Where("id = ?", stale2.ID).Update("expires_at", now.Add(-time.Minute))
	if ok, _ := applyPairingDecision(stale2, models.ProviderPairingApproved, e.owner.ID, now); ok {
		t.Error("a decision landed on an expired pairing")
	}
}

// Smoke test: several polls racing over HTTP still mint one credential. The guarantee
// itself is proven deterministically by the StaleSnapshot tests above.
func TestProviderPairing_ConcurrentRedeemMintsOnce(t *testing.T) {
	e := newPairingEnv(t)
	s := e.start()
	e.decide(s.UserCode, "approve", e.asOwner())

	const pollers = 8
	codes := make([]int, pollers)
	var wg sync.WaitGroup
	for i := 0; i < pollers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			codes[i] = e.poll(s.DeviceCode).Code
		}(i)
	}
	wg.Wait()

	ok, gone := 0, 0
	for _, c := range codes {
		switch c {
		case http.StatusOK:
			ok++
		case http.StatusGone:
			gone++
		}
	}
	if ok != 1 || gone != pollers-1 {
		t.Errorf("status codes %v: want exactly one 200 and %d 410", codes, pollers-1)
	}
	if n := e.pairedTokenCount(); n != 1 {
		t.Errorf("tokens minted = %d, want 1", n)
	}
	var nodes int64
	db.DB.Model(&models.ProviderNode{}).Where("user_id = ?", e.owner.ID).Count(&nodes)
	if nodes != 1 {
		t.Errorf("nodes created = %d, want 1", nodes)
	}
}

func TestProviderPairing_DenyNeverMintsACredential(t *testing.T) {
	e := newPairingEnv(t)
	s := e.start()

	if w := e.decide(s.UserCode, "deny", e.asOwner()); w.Code != http.StatusOK {
		t.Fatalf("deny: %d %s", w.Code, w.Body.String())
	}
	w := e.poll(s.DeviceCode)
	if w.Code != http.StatusForbidden || decodeMap(t, w)["status"] != "denied" {
		t.Errorf("poll after deny: %d %s, want 403 denied", w.Code, w.Body.String())
	}
	if n := e.pairedTokenCount(); n != 0 {
		t.Errorf("tokens minted after deny = %d, want 0", n)
	}
}

func TestProviderPairing_ExpiredNeverRedeems(t *testing.T) {
	past := time.Now().Add(-time.Minute)

	t.Run("pending request expires", func(t *testing.T) {
		e := newPairingEnv(t)
		s := e.start()
		db.DB.Model(&models.ProviderPairing{}).Where("device_code_hash = ?", hashPairingDeviceCode(s.DeviceCode)).Update("expires_at", past)

		if w := e.do(http.MethodGet, "/v1/provider/pair/lookup?code="+s.UserCode, nil, e.asOwner()); w.Code != http.StatusNotFound {
			t.Errorf("lookup of expired code = %d, want 404", w.Code)
		}
		if w := e.decide(s.UserCode, "approve", e.asOwner()); w.Code != http.StatusNotFound {
			t.Errorf("approve of expired code = %d, want 404", w.Code)
		}
		if w := e.poll(s.DeviceCode); w.Code != http.StatusGone || decodeMap(t, w)["status"] != "expired" {
			t.Errorf("poll of expired pairing: %d %s", w.Code, w.Body.String())
		}
	})

	t.Run("approved but not collected in time", func(t *testing.T) {
		e := newPairingEnv(t)
		s := e.start()
		e.decide(s.UserCode, "approve", e.asOwner())
		db.DB.Model(&models.ProviderPairing{}).Where("device_code_hash = ?", hashPairingDeviceCode(s.DeviceCode)).Update("expires_at", past)

		if w := e.poll(s.DeviceCode); w.Code != http.StatusGone || decodeMap(t, w)["status"] != "expired" {
			t.Errorf("poll of lapsed approval: %d %s", w.Code, w.Body.String())
		}
		if n := e.pairedTokenCount(); n != 0 {
			t.Errorf("tokens minted for a lapsed approval = %d, want 0", n)
		}
	})
}

// Once decided, a request cannot be decided again: approve-then-deny must not revoke an
// approval the node may already be redeeming, and deny-then-approve must not resurrect.
func TestProviderPairing_DecisionIsFinal(t *testing.T) {
	e := newPairingEnv(t)
	s := e.start()

	if w := e.decide(s.UserCode, "approve", e.asOwner()); w.Code != http.StatusOK {
		t.Fatalf("approve: %d", w.Code)
	}
	if w := e.decide(s.UserCode, "approve", e.asOwner()); w.Code != http.StatusNotFound {
		t.Errorf("second approve = %d, want 404", w.Code)
	}
	if w := e.decide(s.UserCode, "deny", e.asOwner()); w.Code != http.StatusNotFound {
		t.Errorf("deny after approve = %d, want 404", w.Code)
	}
	if got := e.row(s.DeviceCode).Status; got != models.ProviderPairingApproved {
		t.Errorf("status = %q, want approved", got)
	}
}

// ── who may decide ───────────────────────────────────────────────────────────

// Authn and authz are separate claims, and each gets a negative and a positive case.
func TestProviderPairing_OnlyProviderOwnersCanDecide(t *testing.T) {
	e := newPairingEnv(t)
	s := e.start()

	// No credentials at all.
	if w := e.do(http.MethodGet, "/v1/provider/pair/lookup?code="+s.UserCode, nil, nil); w.Code != http.StatusUnauthorized {
		t.Errorf("anonymous lookup = %d, want 401", w.Code)
	}
	if w := e.decide(s.UserCode, "approve", nil); w.Code != http.StatusUnauthorized {
		t.Errorf("anonymous approve = %d, want 401", w.Code)
	}

	// Signed in, but not a provider: same gate as POST /provider/tokens.
	if w := e.do(http.MethodGet, "/v1/provider/pair/lookup?code="+s.UserCode, nil, e.asBuyer()); w.Code != http.StatusForbidden {
		t.Errorf("buyer lookup = %d, want 403", w.Code)
	}
	if w := e.decide(s.UserCode, "approve", e.asBuyer()); w.Code != http.StatusForbidden {
		t.Errorf("buyer approve = %d, want 403", w.Code)
	}
	if got := e.row(s.DeviceCode).Status; got != models.ProviderPairingPending {
		t.Fatalf("a rejected caller changed the pairing to %q", got)
	}

	// The positive case: a provider can.
	if w := e.decide(s.UserCode, "approve", e.asOwner()); w.Code != http.StatusOK {
		t.Errorf("provider approve = %d, want 200", w.Code)
	}
	if row := e.row(s.DeviceCode); row.UserID == nil || *row.UserID != e.owner.ID {
		t.Errorf("approver recorded as %v, want %s", row.UserID, e.owner.ID)
	}
}

// A provider-node token sits on a provider's disk. If it could approve pairings it could
// mint fresh tokens, which POST /provider/tokens already forbids it to do.
func TestProviderPairing_NodeTokenCannotApprove(t *testing.T) {
	e := newPairingEnv(t)
	s := e.start()

	nodeToken := e.asOwner()
	nodeToken["X-Test-Auth-Type"] = middleware.AuthTypeProviderToken

	for name, w := range map[string]*httptest.ResponseRecorder{
		"lookup":   e.do(http.MethodGet, "/v1/provider/pair/lookup?code="+s.UserCode, nil, nodeToken),
		"decision": e.decide(s.UserCode, "approve", nodeToken),
	} {
		if w.Code != http.StatusForbidden {
			t.Errorf("node token on %s = %d, want 403", name, w.Code)
		}
	}
	if got := e.row(s.DeviceCode).Status; got != models.ProviderPairingPending {
		t.Errorf("node token changed the pairing to %q", got)
	}
	// The same user's normal session still can.
	if w := e.decide(s.UserCode, "approve", e.asOwner()); w.Code != http.StatusOK {
		t.Errorf("normal session approve = %d, want 200", w.Code)
	}
}

// ── what start and poll reveal ───────────────────────────────────────────────

func TestProviderPairing_BadCodesAreIndistinguishable(t *testing.T) {
	e := newPairingEnv(t)
	s := e.start()

	// Unknown, malformed and wrong-length device codes all fail the same way.
	for _, code := range []string{strings.Repeat("0", 64), strings.Repeat("a", 63), "not hex", ""} {
		if w := e.poll(code); w.Code != http.StatusBadRequest || decodeMap(t, w)["status"] != "invalid" {
			t.Errorf("poll(%q) = %d %s, want 400 invalid", code, w.Code, w.Body.String())
		}
	}
	// Unknown, malformed and already-decided user codes look identical to the owner.
	e.decide(s.UserCode, "approve", e.asOwner())
	var bodies []string
	for _, code := range []string{s.UserCode, "BCDF-GHJK", "nonsense", "AAAA-AAAA"} {
		w := e.do(http.MethodGet, "/v1/provider/pair/lookup?code="+code, nil, e.asOwner())
		if w.Code != http.StatusNotFound {
			t.Errorf("lookup(%q) = %d, want 404", code, w.Code)
		}
		bodies = append(bodies, w.Body.String())
	}
	for _, b := range bodies[1:] {
		if b != bodies[0] {
			t.Errorf("lookup 404 bodies differ: %q vs %q", b, bodies[0])
		}
	}
}

func TestProviderPairing_SecretsAreNotStored(t *testing.T) {
	e := newPairingEnv(t)
	s := e.start()
	row := e.row(s.DeviceCode)

	if row.DeviceCodeHash == s.DeviceCode || row.DeviceCodeHash != hashPairingDeviceCode(s.DeviceCode) {
		t.Errorf("device_code_hash = %q: want the SHA-256 of the code, not the code", row.DeviceCodeHash)
	}
	if strings.Contains(fmt.Sprintf("%+v", row), s.DeviceCode) {
		t.Error("the raw device code is present in the stored row")
	}
	// And the JSON shape the API could ever serialize omits the hash.
	if b, _ := json.Marshal(row); strings.Contains(string(b), row.DeviceCodeHash) {
		t.Error("device_code_hash is serialized")
	}
}

// Each route has its own rate-limit budget. A limiter keyed only by caller makes the routes
// share one: the in-memory fallback sizes a caller's bucket from whichever route reaches
// it first, so a node's own polling could use up the allowance for start, or the reverse.
func TestProviderPairing_RouteBudgetsAreIndependent(t *testing.T) {
	unknownDevice := strings.Repeat("0", 64)

	t.Run("polling does not eat the start budget", func(t *testing.T) {
		e := newPairingEnv(t)
		e.start() // the first request is the one that would size a shared bucket
		for i := 0; i < 40; i++ {
			if w := e.poll(unknownDevice); w.Code != http.StatusBadRequest {
				t.Fatalf("poll #%d = %d %s, want 400 (an unknown code), not a rate limit", i+1, w.Code, w.Body.String())
			}
		}
		if w := e.do(http.MethodPost, "/v1/provider/pair/start", map[string]string{"device_name": "again"}, nil); w.Code != http.StatusCreated {
			t.Errorf("start after heavy polling = %d %s, want 201", w.Code, w.Body.String())
		}
	})

	t.Run("exhausting start does not block polling", func(t *testing.T) {
		e := newPairingEnv(t)
		var limited bool
		for i := 0; i < 25 && !limited; i++ {
			w := e.do(http.MethodPost, "/v1/provider/pair/start", map[string]string{"device_name": "burst"}, nil)
			limited = w.Code == http.StatusTooManyRequests
			if limited && decodeMap(t, w)["error"] != "rate_limit_exceeded" {
				t.Errorf("start was refused by %s, want the per-minute limiter", w.Body.String())
			}
		}
		if !limited {
			t.Fatal("start was never rate limited")
		}
		if w := e.poll(unknownDevice); w.Code != http.StatusBadRequest {
			t.Errorf("poll while start is limited = %d %s, want 400", w.Code, w.Body.String())
		}
	})

	t.Run("owner routes are limited per user, not per address", func(t *testing.T) {
		e := newPairingEnv(t)
		lookup := func(h map[string]string) int {
			return e.do(http.MethodGet, "/v1/provider/pair/lookup?code=BCDF-GHJK", nil, h).Code
		}
		// Both users arrive from the same address (as they do behind Cloudflare).
		other := testutil.CreateTestUser(t, testutil.UniqueEmail("pair-other"), "provider")
		otherHeaders := map[string]string{"X-Test-User": other.ID.String(), "X-Test-Role": "provider"}

		var limited bool
		for i := 0; i < 40 && !limited; i++ {
			limited = lookup(e.asOwner()) == http.StatusTooManyRequests
		}
		if !limited {
			t.Fatal("the owner was never rate limited")
		}
		if got := lookup(otherHeaders); got != http.StatusNotFound {
			t.Errorf("a second user on the same address got %d, want 404 (their own budget)", got)
		}
	})
}

func TestProviderPairing_StartIsCappedPerAddress(t *testing.T) {
	e := newPairingEnv(t)
	// Seed rows directly: going through the router would trip the per-minute limiter first.
	for i := 0; i < pairingMaxPerIPPerHour; i++ {
		if err := db.DB.Create(&models.ProviderPairing{
			DeviceCodeHash: fmt.Sprintf("%064x", i),
			UserCode:       fmt.Sprintf("SEED%04d", i),
			Status:         models.ProviderPairingPending,
			CreatedIP:      e.ip,
			NextPollAt:     time.Now(),
			ExpiresAt:      time.Now().Add(time.Minute),
		}).Error; err != nil {
			t.Fatalf("seed row %d: %v", i, err)
		}
	}
	w := e.do(http.MethodPost, "/v1/provider/pair/start", map[string]string{"device_name": "one too many"}, nil)
	if w.Code != http.StatusTooManyRequests || decodeMap(t, w)["code"] != "pairing_rate_limited" {
		t.Fatalf("start past the cap: %d %s, want 429 pairing_rate_limited", w.Code, w.Body.String())
	}
	// A different address is unaffected.
	e.ip = "203.0.113.200"
	e.start()
}

func TestProviderPairing_DeviceMetadataIsSanitized(t *testing.T) {
	e := newPairingEnv(t)
	long := strings.Repeat("é", 300)
	w := e.do(http.MethodPost, "/v1/provider/pair/start", map[string]string{
		"device_name": "Evil\r\nName\x00<script>alert(1)</script>\t" + long,
		"platform":    long,
	}, nil)
	if w.Code != http.StatusCreated {
		t.Fatalf("start: %d %s", w.Code, w.Body.String())
	}
	var s startedPairing
	_ = json.Unmarshal(w.Body.Bytes(), &s)
	row := e.row(s.DeviceCode)

	if strings.ContainsAny(row.DeviceName, "\r\n\x00\t") {
		t.Errorf("control characters survived: %q", row.DeviceName)
	}
	if n := len([]rune(row.DeviceName)); n > 100 {
		t.Errorf("device_name is %d runes, want <= 100", n)
	}
	if n := len([]rune(row.Platform)); n > 32 {
		t.Errorf("platform is %d runes, want <= 32", n)
	}
}

func TestProviderPairing_StartWithNoBodyStillWorks(t *testing.T) {
	e := newPairingEnv(t)
	req := httptest.NewRequest(http.MethodPost, "/v1/provider/pair/start", nil)
	req.Header.Set("X-Forwarded-For", e.ip)
	w := httptest.NewRecorder()
	e.r.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("empty-body start: %d %s", w.Code, w.Body.String())
	}
	var s startedPairing
	_ = json.Unmarshal(w.Body.Bytes(), &s)
	if got := e.row(s.DeviceCode).DeviceName; got != "Unnamed device" {
		t.Errorf("default device name = %q", got)
	}

	bad := httptest.NewRequest(http.MethodPost, "/v1/provider/pair/start", strings.NewReader("{not json"))
	bad.Header.Set("X-Forwarded-For", e.ip)
	bw := httptest.NewRecorder()
	e.r.ServeHTTP(bw, bad)
	if bw.Code != http.StatusBadRequest {
		t.Errorf("malformed JSON start = %d, want 400", bw.Code)
	}
}

// start and poll take no credentials, and the control API has no global body limit, so
// the routes cap their own bodies. An oversized body must be refused without creating a
// pairing, and a body just inside the cap must still work.
func TestProviderPairing_OversizedBodiesAreRefused(t *testing.T) {
	e := newPairingEnv(t)
	pairingRows := func() int64 {
		var n int64
		if err := db.DB.Model(&models.ProviderPairing{}).Count(&n).Error; err != nil {
			t.Fatalf("count pairings: %v", err)
		}
		return n
	}
	post := func(path, body string, headers map[string]string) int {
		req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Forwarded-For", e.ip)
		for k, v := range headers {
			req.Header.Set(k, v)
		}
		w := httptest.NewRecorder()
		e.r.ServeHTTP(w, req)
		return w.Code
	}
	pad := func(n int) string { return strings.Repeat("a", n) }

	if got := post("/v1/provider/pair/start", `{"device_name":"`+pad(pairingMaxBodyBytes*2)+`"}`, nil); got != http.StatusBadRequest {
		t.Errorf("oversized start = %d, want 400", got)
	}
	if n := pairingRows(); n != 0 {
		t.Errorf("an oversized start created %d pairing row(s)", n)
	}
	if got := post("/v1/provider/pair/poll", `{"device_code":"`+pad(pairingMaxBodyBytes*2)+`"}`, nil); got != http.StatusBadRequest {
		t.Errorf("oversized poll = %d, want 400", got)
	}
	if got := post("/v1/provider/pair/decision", `{"code":"`+pad(pairingMaxBodyBytes*2)+`","decision":"approve"}`, e.asOwner()); got != http.StatusBadRequest {
		t.Errorf("oversized decision = %d, want 400", got)
	}

	// Just inside the cap: a long device name is accepted and clipped to its own limit,
	// so the body cap does not shorten anything a real client sends.
	if got := post("/v1/provider/pair/start", `{"device_name":"`+pad(pairingMaxBodyBytes-512)+`"}`, nil); got != http.StatusCreated {
		t.Errorf("start just inside the cap = %d, want 201", got)
	}
}

// start purges rows well past expiry and nothing else: a device that polls a little late
// must still be told "expired" or "redeemed", not "unknown".
func TestProviderPairing_StartPurgesOnlyRowsPastRetention(t *testing.T) {
	e := newPairingEnv(t)
	now := time.Now().UTC()
	approver := e.owner.ID

	seed := func(status string, expiredAgo time.Duration) uuid.UUID {
		t.Helper()
		code, err := newPairingUserCode()
		if err != nil {
			t.Fatalf("user code: %v", err)
		}
		p := models.ProviderPairing{
			ID:             uuid.New(),
			DeviceCodeHash: hashPairingDeviceCode(uuid.NewString() + uuid.NewString()),
			UserCode:       code,
			Status:         status,
			CreatedIP:      "203.0.113.250",
			NextPollAt:     now,
			ExpiresAt:      now.Add(-expiredAgo),
		}
		if status == models.ProviderPairingApproved || status == models.ProviderPairingRedeemed {
			p.UserID = &approver
		}
		if err := db.DB.Create(&p).Error; err != nil {
			t.Fatalf("seed %s pairing: %v", status, err)
		}
		return p.ID
	}
	exists := func(id uuid.UUID) bool {
		var n int64
		if err := db.DB.Model(&models.ProviderPairing{}).Where("id = ?", id).Count(&n).Error; err != nil {
			t.Fatalf("count: %v", err)
		}
		return n == 1
	}

	staleExpired := seed(models.ProviderPairingPending, pairingPurgeAfter+time.Hour)
	staleRedeemed := seed(models.ProviderPairingRedeemed, pairingPurgeAfter+time.Hour)
	recentExpired := seed(models.ProviderPairingPending, time.Hour)
	recentRedeemed := seed(models.ProviderPairingRedeemed, pairingPurgeAfter-time.Hour)
	live := seed(models.ProviderPairingApproved, -pairingTTL)

	e.start() // any start runs the purge

	for name, id := range map[string]uuid.UUID{"expired long ago": staleExpired, "redeemed long ago": staleRedeemed} {
		if exists(id) {
			t.Errorf("%s: row should have been purged", name)
		}
	}
	for name, id := range map[string]uuid.UUID{"expired an hour ago": recentExpired, "redeemed inside retention": recentRedeemed, "live approved": live} {
		if !exists(id) {
			t.Errorf("%s: row must be kept", name)
		}
	}
}

// failInsertInto makes every insert into `table` fail, inside this process only, with an error
// shaped like Postgres's foreign key violation. It stands in for a production database whose
// schema or data rejects one step of redeeming an approval. A hook rather than a constraint,
// because the test database is shared and a temporary constraint would reach other packages.
func failInsertInto(t *testing.T, table string) (stop func()) {
	t.Helper()
	name := "zz_pairing_test_fail_" + table
	err := db.DB.Callback().Create().Before("gorm:create").Register(name, func(tx *gorm.DB) {
		if tx.Statement != nil && tx.Statement.Table == table {
			_ = tx.AddError(fmt.Errorf("ERROR: insert or update on table %q violates foreign key constraint \"fk_test\" (SQLSTATE 23503)", table))
		}
	})
	if err != nil {
		t.Fatalf("register failing hook for %s: %v", table, err)
	}
	var once sync.Once
	stop = func() { once.Do(func() { _ = db.DB.Callback().Create().Remove(name) }) }
	t.Cleanup(stop)
	return stop
}

// A failed redeem must say which step failed, create nothing, leave the approval intact and
// answer with something the node can retry: the poll that follows, once the cause is gone,
// has to succeed. Before, the 500 said only "failed to complete pairing".
func TestProviderPairing_FailedRedeemNamesTheStepAndKeepsTheApproval(t *testing.T) {
	steps := []struct{ step, table string }{
		{"token", "provider_tokens"},
		{"node", "provider_nodes"},
		{"registration", "provider_node_registrations"},
	}
	for _, tc := range steps {
		t.Run(tc.step, func(t *testing.T) {
			e := newPairingEnv(t)
			s := e.start()
			if w := e.decide(s.UserCode, "approve", e.asOwner()); w.Code != http.StatusOK {
				t.Fatalf("approve: %d %s", w.Code, w.Body.String())
			}
			stop := failInsertInto(t, tc.table)

			w := e.poll(s.DeviceCode)
			if w.Code != http.StatusInternalServerError {
				t.Fatalf("poll while %s fails: %d %s, want 500", tc.table, w.Code, w.Body.String())
			}
			m := decodeMap(t, w)
			if m["code"] != "pairing_redeem_failed" || m["step"] != tc.step || m["sqlstate"] != "23503" {
				t.Errorf("failure body = %v, want code pairing_redeem_failed, step %q, sqlstate 23503", m, tc.step)
			}
			if _, leaked := m["api_key"]; leaked {
				t.Error("a failed redeem must never carry a key")
			}
			if strings.Contains(w.Body.String(), tc.table) || strings.Contains(w.Body.String(), "fk_test") {
				t.Errorf("the response must not repeat the database's own message: %s", w.Body.String())
			}

			// Rolled back: nothing minted, and the approval is exactly as it was.
			var nodes, regs int64
			db.DB.Model(&models.ProviderNode{}).Where("user_id = ?", e.owner.ID).Count(&nodes)
			db.DB.Model(&models.ProviderNodeRegistration{}).Where("user_id = ?", e.owner.ID).Count(&regs)
			if n := e.pairedTokenCount(); n != 0 || nodes != 0 || regs != 0 {
				t.Errorf("a failed redeem left %d token(s), %d node(s), %d registration(s)", n, nodes, regs)
			}
			if row := e.row(s.DeviceCode); row.Status != models.ProviderPairingApproved || row.RedeemedAt != nil {
				t.Errorf("approval was consumed by a failed redeem: status %q, redeemed_at %v", row.Status, row.RedeemedAt)
			}

			// The cause goes away (a redeploy finishes, a hiccup passes): the same device code works.
			stop()
			w = e.poll(s.DeviceCode)
			if w.Code != http.StatusOK || decodeMap(t, w)["api_key"] == nil {
				t.Fatalf("retry after the cause is gone: %d %s", w.Code, w.Body.String())
			}
			if n := e.pairedTokenCount(); n != 1 {
				t.Errorf("after the retry there should be exactly one paired token, got %d", n)
			}
		})
	}
}

// The same report for a REAL Postgres error: the approver's account disappears between the
// approval and the redeem, so a foreign key rejects the insert. The response must carry the
// error class (23503), not the database's text.
func TestProviderPairing_RealDatabaseErrorIsReportedByClass(t *testing.T) {
	e := newPairingEnv(t)
	s := e.start()
	if w := e.decide(s.UserCode, "approve", e.asOwner()); w.Code != http.StatusOK {
		t.Fatalf("approve: %d %s", w.Code, w.Body.String())
	}
	// provider_tokens, provider_nodes and provider_node_registrations all reference profiles,
	// while the pairing row itself does not, so the approval survives the account and the
	// redeem trips a real foreign key at its first insert.
	if err := db.DB.Exec("DELETE FROM profiles WHERE id = ?", e.owner.ID).Error; err != nil {
		t.Fatalf("remove the approver's profile: %v", err)
	}

	w := e.poll(s.DeviceCode)
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("poll after the approver was removed: %d %s, want 500", w.Code, w.Body.String())
	}
	m := decodeMap(t, w)
	if m["sqlstate"] != "23503" {
		t.Errorf("sqlstate = %v, want 23503 (foreign key violation); body %v", m["sqlstate"], m)
	}
	if step, _ := m["step"].(string); step == "" {
		t.Errorf("a database failure inside the transaction must name its step: %v", m)
	}
	if strings.Contains(strings.ToLower(w.Body.String()), "violates") {
		t.Errorf("the response must not repeat the database's own message: %s", w.Body.String())
	}
}

func TestSQLStateOf(t *testing.T) {
	cases := map[string]string{
		`ERROR: insert or update on table "x" violates foreign key constraint "y" (SQLSTATE 23503)`: "23503",
		`ERROR: duplicate key value violates unique constraint "u" (SQLSTATE 23505)`:                "23505",
		`ERROR: invalid input syntax for type inet: "" (SQLSTATE 22P02)`:                            "22P02",
		`dial tcp: connection refused`: "",
	}
	for text, want := range cases {
		if got := sqlStateOf(errors.New(text)); got != want {
			t.Errorf("sqlStateOf(%q) = %q, want %q", text, got, want)
		}
	}
	if got := sqlStateOf(nil); got != "" {
		t.Errorf("sqlStateOf(nil) = %q", got)
	}
}

// ── pure helpers (no database) ───────────────────────────────────────────────

func TestNormalizePairingUserCode(t *testing.T) {
	good := map[string]string{
		"BCDF-GHJK":    "BCDFGHJK",
		"bcdf-ghjk":    "BCDFGHJK",
		"  bcdf ghjk ": "BCDFGHJK",
		"BCDFGHJK":     "BCDFGHJK",
	}
	for in, want := range good {
		if got, ok := normalizePairingUserCode(in); !ok || got != want {
			t.Errorf("normalize(%q) = %q,%v want %q,true", in, got, ok, want)
		}
	}
	// Vowels, digits, and wrong lengths can never be a code.
	for _, in := range []string{"", "BCDF", "BCDF-GHJKL", "ABCD-EFGH", "BCD0-GHJK", "BCDF-GHJ1", "BCDF/GHJK"} {
		if got, ok := normalizePairingUserCode(in); ok {
			t.Errorf("normalize(%q) accepted as %q", in, got)
		}
	}
}

func TestNewPairingUserCode(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 2000; i++ {
		code, err := newPairingUserCode()
		if err != nil {
			t.Fatal(err)
		}
		if len(code) != pairingUserCodeLen {
			t.Fatalf("code %q has length %d", code, len(code))
		}
		if back, ok := normalizePairingUserCode(formatPairingUserCode(code)); !ok || back != code {
			t.Fatalf("code %q does not survive format+normalize (%q,%v)", code, back, ok)
		}
		seen[code] = true
	}
	// 2000 draws from 2.6e10 codes: a repeat would mean the generator is broken.
	if len(seen) != 2000 {
		t.Errorf("only %d distinct codes in 2000 draws", len(seen))
	}
}

func TestValidPairingDeviceCode(t *testing.T) {
	raw, hash, err := newPairingDeviceCode()
	if err != nil {
		t.Fatal(err)
	}
	if !validPairingDeviceCode(raw) || raw == hash || hash != hashPairingDeviceCode(raw) {
		t.Errorf("device code %q / hash %q malformed", raw, hash)
	}
	for _, bad := range []string{"", strings.Repeat("A", 64), strings.Repeat("g", 64), raw[:63], raw + "0"} {
		if validPairingDeviceCode(bad) {
			t.Errorf("validPairingDeviceCode(%q) = true", bad)
		}
	}
}

func TestCleanPairingText(t *testing.T) {
	cases := []struct {
		in   string
		max  int
		want string
	}{
		{"  Jane's   Laptop ", 100, "Jane's Laptop"},
		{"a\r\nb\tc\x00d", 100, "a b c d"},
		{"ééééé", 3, "ééé"},
		{"bad\xffutf8", 100, "badutf8"},
		{"", 100, ""},
	}
	for _, tc := range cases {
		if got := cleanPairingText(tc.in, tc.max); got != tc.want {
			t.Errorf("cleanPairingText(%q, %d) = %q, want %q", tc.in, tc.max, got, tc.want)
		}
	}
}
