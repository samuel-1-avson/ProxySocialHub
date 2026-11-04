package api

import (
	"bytes"
	"crypto/ed25519"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"github.com/mr-tron/base58"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	providerProofs "github.com/proxyhubb/control-api/internal/proofs"
	"github.com/proxyhubb/control-api/internal/testutil"
	"gorm.io/gorm"
)

type offerSignFixture struct {
	router  *gin.Engine
	owner   uuid.UUID
	nodeID  uuid.UUID
	gateway string
	hotkey  string
	key     ed25519.PrivateKey
}

// as is the signed-in account the next request runs as.
var offerSignActingUser uuid.UUID

func setupOfferSignFixture(t *testing.T) offerSignFixture {
	t.Helper()
	gin.SetMode(gin.TestMode)
	t.Setenv("LISTING_QUALITY_MODE", "observe")
	gdb, err := gorm.Open(sqlite.Open("file:offersign_"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("sqlite: %v", err)
	}
	for _, stmt := range []string{
		`CREATE TABLE provider_nodes (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			name TEXT NOT NULL DEFAULT '',
			country TEXT NOT NULL DEFAULT '',
			city TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT 'online',
			gateway_node_id TEXT NOT NULL DEFAULT '',
			hotkey TEXT NOT NULL DEFAULT '',
			last_seen_at DATETIME,
			created_at DATETIME,
			updated_at DATETIME,
			deleted_at DATETIME
		)`,
		`CREATE TABLE proxy_listings (
			id TEXT PRIMARY KEY,
			seller_id TEXT NOT NULL,
			provider_node_id TEXT,
			title TEXT NOT NULL DEFAULT '',
			description TEXT NOT NULL DEFAULT '',
			proxy_type TEXT NOT NULL DEFAULT 'residential',
			protocol TEXT NOT NULL DEFAULT 'http',
			rotation_type TEXT NOT NULL DEFAULT '',
			country TEXT NOT NULL DEFAULT '',
			isp TEXT NOT NULL DEFAULT '',
			price_per_gb REAL NOT NULL DEFAULT 0,
			min_purchase_gb REAL NOT NULL DEFAULT 1,
			available_bandwidth_gb REAL NOT NULL DEFAULT 0,
			max_concurrency INTEGER NOT NULL DEFAULT 5,
			status TEXT NOT NULL DEFAULT 'active',
			created_at DATETIME,
			updated_at DATETIME
		)`,
	} {
		if err := gdb.Exec(stmt).Error; err != nil {
			t.Fatalf("create table: %v", err)
		}
	}
	previousDB := db.DB
	db.DB = gdb
	t.Cleanup(func() { db.DB = previousDB })
	testutil.SetupTestRedis(t)

	previousInterval := offerSignPollInterval
	offerSignPollInterval = 10 * time.Millisecond
	t.Cleanup(func() { offerSignPollInterval = previousInterval })

	pub, key, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatalf("key: %v", err)
	}
	f := offerSignFixture{
		owner:   uuid.New(),
		nodeID:  uuid.New(),
		gateway: "gw-test-node",
		hotkey:  base58.Encode(pub),
		key:     key,
	}
	now := time.Now().UTC()
	if err := gdb.Exec(`INSERT INTO provider_nodes (id, user_id, name, country, status, gateway_node_id, hotkey, created_at, updated_at)
		VALUES (?, ?, 'Test1', 'GH', 'online', ?, ?, ?, ?)`,
		f.nodeID.String(), f.owner.String(), f.gateway, f.hotkey, now, now).Error; err != nil {
		t.Fatalf("insert node: %v", err)
	}

	offerSignActingUser = f.owner
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", offerSignActingUser.String())
		c.Next()
	})
	RegisterProviderNodeRoutes(r.Group("/v1"))
	f.router = r
	return f
}

func (f offerSignFixture) do(t *testing.T, method, path string, body any) (int, map[string]any) {
	t.Helper()
	var reader *bytes.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		reader = bytes.NewReader(raw)
	} else {
		reader = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	f.router.ServeHTTP(w, req)
	out := map[string]any{}
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	return w.Code, out
}

// nodeSign does what provider-node does with one request: rebuild the payload from
// the wire fields (numbers parsed from their strings), hash it, sign the envelope.
func (f offerSignFixture) nodeSign(t *testing.T, work map[string]any, key ed25519.PrivateKey) models.ProviderProof {
	t.Helper()
	p := work["payload"].(map[string]any)
	num := func(field string) float64 {
		v, err := strconv.ParseFloat(p[field].(string), 64)
		if err != nil {
			t.Fatalf("%s: %v", field, err)
		}
		return v
	}
	nodeID, err := uuid.Parse(p["provider_node_id"].(string))
	if err != nil {
		t.Fatalf("node id: %v", err)
	}
	hash := providerProofs.HashListingOfferPayload(providerProofs.ListingOfferPayload{
		ProviderNodeID:       nodeID,
		GatewayNodeID:        p["gateway_node_id"].(string),
		Title:                p["title"].(string),
		Description:          p["description"].(string),
		ProxyType:            p["proxy_type"].(string),
		Protocol:             p["protocol"].(string),
		RotationType:         p["rotation_type"].(string),
		Country:              p["country"].(string),
		ISP:                  p["isp"].(string),
		PricePerGB:           num("price_per_gb"),
		MinPurchaseGB:        num("min_purchase_gb"),
		AvailableBandwidthGB: num("available_bandwidth_gb"),
		MaxConcurrency:       int(p["max_concurrency"].(float64)),
		Status:               p["status"].(string),
		ExpiresAt:            int64(p["expires_at"].(float64)),
	})
	if hash != work["payload_hash"] {
		t.Fatalf("node-side hash %s != server hash %v", hash, work["payload_hash"])
	}
	envelope := providerProofs.ProviderProofEnvelope{
		MessageType:    providerProofs.ListingOfferMessageType,
		Version:        providerProofs.ProviderProofVersion,
		ProviderNodeID: nodeID.String(),
		GatewayNodeID:  p["gateway_node_id"].(string),
		ProviderHotkey: base58.Encode(key.Public().(ed25519.PublicKey)),
		IssuedAt:       time.Now().Unix(),
		Nonce:          uuid.NewString(),
		PayloadHash:    hash,
	}
	sig := ed25519.Sign(key, []byte(providerProofs.BuildProviderProofMessage(envelope)))
	return models.ProviderProof{
		MessageType:    envelope.MessageType,
		Version:        envelope.Version,
		ProviderNodeID: envelope.ProviderNodeID,
		GatewayNodeID:  envelope.GatewayNodeID,
		ProviderHotkey: envelope.ProviderHotkey,
		IssuedAt:       envelope.IssuedAt,
		Nonce:          envelope.Nonce,
		PayloadHash:    envelope.PayloadHash,
		Signature:      base58.Encode(sig),
	}
}

func newListingRequest(nodeID uuid.UUID) models.CreateListingRequest {
	return models.CreateListingRequest{
		Title:                "Accra home fibre",
		Description:          "Residential line: weekdays only",
		ProviderNodeID:       &nodeID,
		ProxyType:            "residential",
		Protocol:             "socks5,http,HTTPS",
		RotationType:         "rotating",
		PricePerGB:           0.792,
		MinPurchaseGB:        1,
		AvailableBandwidthGB: 13,
		MaxConcurrency:       10,
	}
}

func TestNodeSignsNewOfferAndProofVerifiesForCreateListing(t *testing.T) {
	f := setupOfferSignFixture(t)
	listing := newListingRequest(f.nodeID)

	code, created := f.do(t, http.MethodPost, "/v1/provider/listings/offer-signatures", gin.H{"listing": listing})
	if code != http.StatusCreated {
		t.Fatalf("create = %d %v", code, created)
	}
	if created["status"] != "pending" || created["node_listening"] != false {
		t.Fatalf("unexpected create view: %v", created)
	}
	rid := created["id"].(string)

	code, polled := f.do(t, http.MethodGet, "/v1/provider/nodes/"+f.nodeID.String()+"/offer-signatures?wait=1", nil)
	if code != http.StatusOK {
		t.Fatalf("poll = %d %v", code, polled)
	}
	requests := polled["requests"].([]any)
	if len(requests) != 1 {
		t.Fatalf("want 1 request, got %v", polled)
	}
	work := requests[0].(map[string]any)
	payload := work["payload"].(map[string]any)
	// Canonical terms, not the raw form: protocols normalised, node country filled in.
	if payload["protocol"] != "http,https,socks5" || payload["country"] != "GH" || payload["price_per_gb"] != "0.792" || payload["status"] != "active" {
		t.Fatalf("payload not canonical: %v", payload)
	}

	// Polling marks the node as listening.
	code, status := f.do(t, http.MethodGet, "/v1/provider/nodes/"+f.nodeID.String()+"/offer-signer", nil)
	if code != http.StatusOK || status["listening"] != true {
		t.Fatalf("offer-signer = %d %v", code, status)
	}

	proof := f.nodeSign(t, work, f.key)
	code, answered := f.do(t, http.MethodPost, "/v1/provider/nodes/"+f.nodeID.String()+"/offer-signatures/"+rid, gin.H{"proof": proof})
	if code != http.StatusOK || answered["status"] != "signed" {
		t.Fatalf("answer = %d %v", code, answered)
	}

	code, view := f.do(t, http.MethodGet, "/v1/provider/listings/offer-signatures/"+rid, nil)
	if code != http.StatusOK || view["status"] != "signed" || view["proof"] == nil {
		t.Fatalf("view = %d %v", code, view)
	}
	var got models.ProviderProof
	raw, _ := json.Marshal(view["proof"])
	_ = json.Unmarshal(raw, &got)

	// The proof the browser gets back verifies exactly the way createListing checks it.
	req := listing
	req.Protocol, _ = normalizeListingProtocols(req.Protocol)
	terms, err := resolveListingCreateTerms(f.owner, req)
	if err != nil {
		t.Fatalf("terms: %v", err)
	}
	proofContext, _, err := loadListingProofContext(f.owner, terms.ProviderNodeID)
	if err != nil {
		t.Fatalf("proof context: %v", err)
	}
	hash := providerProofs.HashListingOfferPayload(listingCreateOfferPayload(proofContext, req, terms))
	result := verifyProviderProof(got, providerProofs.ListingOfferMessageType, f.hotkey, hash)
	if !result.Verified {
		t.Fatalf("proof does not verify for createListing: %s", result.VerificationError)
	}

	// Answered requests are no longer handed out, and cannot be answered twice.
	_, polled = f.do(t, http.MethodGet, "/v1/provider/nodes/"+f.nodeID.String()+"/offer-signatures", nil)
	if len(polled["requests"].([]any)) != 0 {
		t.Fatalf("signed request handed out again: %v", polled)
	}
	code, _ = f.do(t, http.MethodPost, "/v1/provider/nodes/"+f.nodeID.String()+"/offer-signatures/"+rid, gin.H{"proof": proof})
	if code != http.StatusConflict {
		t.Fatalf("second answer = %d, want 409", code)
	}
}

func TestNodeSignsOfferEdit(t *testing.T) {
	f := setupOfferSignFixture(t)
	listingID := uuid.New()
	now := time.Now().UTC()
	if err := db.DB.Exec(`INSERT INTO proxy_listings (id, seller_id, provider_node_id, title, description, proxy_type, protocol, rotation_type, country, isp, price_per_gb, min_purchase_gb, available_bandwidth_gb, max_concurrency, status, created_at, updated_at)
		VALUES (?, ?, ?, 'Old title', 'Old', 'residential', 'HTTP', '', 'GH', 'MTN', 0.5, 1, 20, 0, 'paused', ?, ?)`,
		listingID.String(), f.owner.String(), f.nodeID.String(), now, now).Error; err != nil {
		t.Fatalf("insert listing: %v", err)
	}
	price := 1.25
	active := models.ListingStatusActive
	update := models.UpdateListingRequest{PricePerGB: &price, Status: &active}

	code, created := f.do(t, http.MethodPost, "/v1/provider/listings/offer-signatures", gin.H{"listing_id": listingID.String(), "update": update})
	if code != http.StatusCreated {
		t.Fatalf("create = %d %v", code, created)
	}
	_, polled := f.do(t, http.MethodGet, "/v1/provider/nodes/"+f.nodeID.String()+"/offer-signatures", nil)
	work := polled["requests"].([]any)[0].(map[string]any)
	payload := work["payload"].(map[string]any)
	if payload["title"] != "Old title" || payload["price_per_gb"] != "1.25" || payload["status"] != "active" ||
		payload["protocol"] != "http" || payload["rotation_type"] != "static" || payload["max_concurrency"] != float64(5) {
		t.Fatalf("edit payload is not the merged, canonical offer: %v", payload)
	}
	if work["listing_id"] != listingID.String() {
		t.Fatalf("listing id missing: %v", work)
	}

	proof := f.nodeSign(t, work, f.key)
	var existing models.ProxyListing
	if err := db.DB.First(&existing, "id = ?", listingID).Error; err != nil {
		t.Fatalf("load listing: %v", err)
	}
	proofContext, _, _ := loadListingProofContext(f.owner, existing.ProviderNodeID)
	hash := providerProofs.HashListingOfferPayload(listingUpdateOfferPayload(proofContext, existing, update))
	if result := verifyProviderProof(proof, providerProofs.ListingOfferMessageType, f.hotkey, hash); !result.Verified {
		t.Fatalf("proof does not verify for updateListing: %s", result.VerificationError)
	}
}

func TestOfferSignatureWithWrongKeyIsRefusedAndReported(t *testing.T) {
	f := setupOfferSignFixture(t)
	_, created := f.do(t, http.MethodPost, "/v1/provider/listings/offer-signatures", gin.H{"listing": newListingRequest(f.nodeID)})
	rid := created["id"].(string)
	_, polled := f.do(t, http.MethodGet, "/v1/provider/nodes/"+f.nodeID.String()+"/offer-signatures", nil)
	work := polled["requests"].([]any)[0].(map[string]any)

	_, otherKey, _ := ed25519.GenerateKey(nil)
	code, _ := f.do(t, http.MethodPost, "/v1/provider/nodes/"+f.nodeID.String()+"/offer-signatures/"+rid, gin.H{"proof": f.nodeSign(t, work, otherKey)})
	if code != http.StatusBadRequest {
		t.Fatalf("wrong key answer = %d, want 400", code)
	}
	_, view := f.do(t, http.MethodGet, "/v1/provider/listings/offer-signatures/"+rid, nil)
	if view["status"] != "refused" || view["proof"] != nil || view["error"] == nil {
		t.Fatalf("browser should see the refusal, got %v", view)
	}
}

func TestNodeCanDeclineAnOffer(t *testing.T) {
	f := setupOfferSignFixture(t)
	_, created := f.do(t, http.MethodPost, "/v1/provider/listings/offer-signatures", gin.H{"listing": newListingRequest(f.nodeID)})
	rid := created["id"].(string)
	code, _ := f.do(t, http.MethodPost, "/v1/provider/nodes/"+f.nodeID.String()+"/offer-signatures/"+rid, gin.H{"refused": "offer is for another node"})
	if code != http.StatusOK {
		t.Fatalf("decline = %d", code)
	}
	_, view := f.do(t, http.MethodGet, "/v1/provider/listings/offer-signatures/"+rid, nil)
	if view["status"] != "refused" {
		t.Fatalf("want refused, got %v", view)
	}
}

func TestOfferSignatureLongPollWakesWhenWorkArrives(t *testing.T) {
	f := setupOfferSignFixture(t)
	type result struct {
		code int
		body map[string]any
		took time.Duration
	}
	done := make(chan result, 1)
	go func() {
		start := time.Now()
		code, body := f.do(t, http.MethodGet, "/v1/provider/nodes/"+f.nodeID.String()+"/offer-signatures?wait=5", nil)
		done <- result{code, body, time.Since(start)}
	}()
	time.Sleep(100 * time.Millisecond)
	if code, created := f.do(t, http.MethodPost, "/v1/provider/listings/offer-signatures", gin.H{"listing": newListingRequest(f.nodeID)}); code != http.StatusCreated {
		t.Fatalf("create = %d %v", code, created)
	}
	select {
	case r := <-done:
		if r.code != http.StatusOK || len(r.body["requests"].([]any)) != 1 {
			t.Fatalf("poll = %d %v", r.code, r.body)
		}
		if r.took > 3*time.Second {
			t.Fatalf("poll waited %s; it should return as soon as work arrives", r.took)
		}
	case <-time.After(6 * time.Second):
		t.Fatal("long poll never returned")
	}
}

func TestOfferSignaturesAreScopedToTheOwner(t *testing.T) {
	f := setupOfferSignFixture(t)
	_, created := f.do(t, http.MethodPost, "/v1/provider/listings/offer-signatures", gin.H{"listing": newListingRequest(f.nodeID)})
	rid := created["id"].(string)

	offerSignActingUser = uuid.New()
	t.Cleanup(func() { offerSignActingUser = f.owner })
	if code, _ := f.do(t, http.MethodGet, "/v1/provider/listings/offer-signatures/"+rid, nil); code != http.StatusNotFound {
		t.Fatalf("stranger read = %d, want 404", code)
	}
	if code, _ := f.do(t, http.MethodGet, "/v1/provider/nodes/"+f.nodeID.String()+"/offer-signatures", nil); code != http.StatusNotFound {
		t.Fatalf("stranger poll = %d, want 404", code)
	}
	if code, _ := f.do(t, http.MethodPost, "/v1/provider/listings/offer-signatures", gin.H{"listing": newListingRequest(f.nodeID)}); code != http.StatusBadRequest {
		t.Fatalf("stranger request for someone else's node = %d, want 400", code)
	}
}

func TestOfferSignatureNeedsAConnectedNode(t *testing.T) {
	f := setupOfferSignFixture(t)
	if err := db.DB.Exec(`UPDATE provider_nodes SET hotkey = '' WHERE id = ?`, f.nodeID.String()).Error; err != nil {
		t.Fatal(err)
	}
	code, body := f.do(t, http.MethodPost, "/v1/provider/listings/offer-signatures", gin.H{"listing": newListingRequest(f.nodeID)})
	if code != http.StatusConflict || body["code"] != "node_hotkey_missing" {
		t.Fatalf("got %d %v", code, body)
	}
}

// The same vector is pinned in provider-node (proofs.rs) and the web
// (scripts/listing-signer.test.mjs): the node now signs what the browser used to.
func TestListingOfferHashVector(t *testing.T) {
	got := providerProofs.HashListingOfferPayload(providerProofs.ListingOfferPayload{
		ProviderNodeID:       uuid.MustParse("11111111-2222-4333-8444-555555555555"),
		GatewayNodeID:        "gw-test",
		Title:                "Accra home fibre",
		Description:          "Residential line: weekdays only",
		ProxyType:            "residential",
		Protocol:             "http,https,socks5",
		RotationType:         "rotating",
		Country:              "GH",
		PricePerGB:           0.792,
		MinPurchaseGB:        1,
		AvailableBandwidthGB: 13,
		MaxConcurrency:       10,
		Status:               "active",
	})
	if want := "f4b6a6b64c4ab8f9da2ef33b4d72d349f1de9c2c13ae4376b63380b8dfbb4938"; got != want {
		t.Fatalf("hash = %s, want %s", got, want)
	}
}

func TestOfferSignPayloadNumbersRoundTrip(t *testing.T) {
	for _, v := range []float64{0.792, 0.1 + 0.2, 13, 1e-7, 49.9999, 123456.789} {
		p := newOfferSignPayload(providerProofs.ListingOfferPayload{PricePerGB: v})
		back, err := strconv.ParseFloat(p.PricePerGB, 64)
		if err != nil || back != v {
			t.Fatalf("%v -> %q -> %v (%v)", v, p.PricePerGB, back, err)
		}
	}
}
