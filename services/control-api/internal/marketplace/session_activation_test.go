package marketplace

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func TestBuildRedisSessionData_pinsListingNodeAndPasswordHash(t *testing.T) {
	buyerID := uuid.New()
	sellerID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	listingID := uuid.New()
	sessionID := uuid.New()
	nodeID := uuid.New()

	order := &models.Order{
		BuyerID:   buyerID,
		SellerID:  sellerID,
		ListingID: listingID,
	}
	session := &models.Session{
		ID:              sessionID,
		Type:            models.SessionRotating,
		BandwidthLimit:  5_000_000_000,
		CredentialsUser: "buyer-cred-user",
		CredentialsPass: "buyer-cred-pass",
		NodeID:          &nodeID,
	}
	listing := &models.ProxyListing{
		ID:         listingID,
		SellerID:   sellerID,
		Country:    "DE",
		ISP:        "Example ISP",
		PricePerGB: 1.25,
	}
	node := &models.ProviderNode{
		ID:        nodeID,
		UserID:    sellerID,
		IPAddress: "10.0.0.5",
		Port:      1080,
	}
	buyer := &models.User{TrustTier: models.TrustTierPremium}

	data := BuildRedisSessionData(order, session, listing, node, buyer)
	if data.ListingID != listingID.String() {
		t.Fatalf("listing_id: got %q want %q", data.ListingID, listingID)
	}
	wantNode := GatewayRoutingNodeID(node)
	if data.NodeID != wantNode {
		t.Fatalf("node_id: got %q want %q", data.NodeID, wantNode)
	}
	if data.NodeHost != "10.0.0.5" || data.NodePort != 1080 {
		t.Fatalf("node host/port: got %s:%d", data.NodeHost, data.NodePort)
	}
	if data.TargetGeo != "DE" || data.TargetISP != "Example ISP" {
		t.Fatalf("geo/isp: got %s / %s", data.TargetGeo, data.TargetISP)
	}
	if data.CredentialPasswordHash != HashCredentialPassword("buyer-cred-pass") {
		t.Fatal("credential_password_hash mismatch")
	}
}

func TestBuildRedisSessionData_roundTripsThroughRedis(t *testing.T) {
	testutil.SetupTestRedis(t)

	buyerID := uuid.New()
	sellerID := uuid.New()
	listingID := uuid.New()
	sessionID := uuid.New()
	nodeID := uuid.New()

	order := &models.Order{BuyerID: buyerID, SellerID: sellerID, ListingID: listingID}
	session := &models.Session{
		ID:              sessionID,
		Type:            models.SessionRotating,
		BandwidthLimit:  1_000_000,
		CredentialsUser: "redis-roundtrip-user",
		CredentialsPass: "redis-roundtrip-pass",
		NodeID:          &nodeID,
	}
	listing := &models.ProxyListing{ID: listingID, SellerID: sellerID, Country: "US"}
	node := &models.ProviderNode{ID: nodeID, UserID: sellerID, GatewayNodeID: "node_pinned_e2e"}
	buyer := &models.User{TrustTier: models.TrustTierVerified}

	data := BuildRedisSessionData(order, session, listing, node, buyer)
	if err := redisClient.StoreSession(session.CredentialsUser, data, time.Hour); err != nil {
		t.Fatalf("StoreSession: %v", err)
	}

	got, err := redisClient.GetSession(session.CredentialsUser)
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	if got.NodeID != "node_pinned_e2e" {
		t.Fatalf("node_id after roundtrip: got %q", got.NodeID)
	}
	if got.ListingID != listingID.String() {
		t.Fatalf("listing_id after roundtrip: got %q", got.ListingID)
	}
	if got.CredentialPasswordHash == "" {
		t.Fatal("expected credential_password_hash in redis payload")
	}
}

func TestActivateOrderSession_PersistsSyncedActivationEvent(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.SetupTestRedis(t)
	testutil.CleanupTestData(t, "escrow_reconciliation_events", "sessions", "orders", "proxy_listings", "provider_nodes", "wallets", "users")

	order, session, _ := createActivationFixture(t)

	if err := ActivateOrderSession(testContext(), order.ID); err != nil {
		t.Fatalf("ActivateOrderSession: %v", err)
	}

	var updated models.Session
	if err := db.DB.First(&updated, "id = ?", session.ID).Error; err != nil {
		t.Fatalf("reload session: %v", err)
	}
	if updated.Status != models.SessionActive {
		t.Fatalf("session status: got %s want %s", updated.Status, models.SessionActive)
	}

	if _, err := redisClient.GetSession(session.CredentialsUser); err != nil {
		t.Fatalf("expected redis session: %v", err)
	}

	var event models.EscrowReconciliationEvent
	if err := db.DB.Where("source = ? AND event_type = ? AND order_id = ?", SessionActivationEventSource, SessionActivationEventType, order.ID).
		First(&event).Error; err != nil {
		t.Fatalf("activation event missing: %v", err)
	}
	if event.Status != models.EscrowReconciliationStatusActivationSynced {
		t.Fatalf("event status: got %s want %s", event.Status, models.EscrowReconciliationStatusActivationSynced)
	}
	if event.Attempts != 1 {
		t.Fatalf("attempts: got %d want 1", event.Attempts)
	}
	if event.ResolvedAt == nil {
		t.Fatal("expected resolved_at for synced activation")
	}
}

func TestActivateOrderSession_RedisUnavailableMarksFailedAndRecordsEvent(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "escrow_reconciliation_events", "sessions", "orders", "proxy_listings", "provider_nodes", "wallets", "users")

	previousRedis := redisClient.Client
	redisClient.Client = nil
	t.Cleanup(func() { redisClient.Client = previousRedis })

	order, session, _ := createActivationFixture(t)

	if err := ActivateOrderSession(testContext(), order.ID); err == nil {
		t.Fatal("expected activation error when redis is unavailable")
	}

	var updated models.Session
	if err := db.DB.First(&updated, "id = ?", session.ID).Error; err != nil {
		t.Fatalf("reload session: %v", err)
	}
	if updated.Status != models.SessionActivationFailed {
		t.Fatalf("session status: got %s want %s", updated.Status, models.SessionActivationFailed)
	}

	var event models.EscrowReconciliationEvent
	if err := db.DB.Where("source = ? AND event_type = ? AND order_id = ?", SessionActivationEventSource, SessionActivationEventType, order.ID).
		First(&event).Error; err != nil {
		t.Fatalf("activation event missing: %v", err)
	}
	if event.Status != models.EscrowReconciliationStatusActivationFailed {
		t.Fatalf("event status: got %s want %s", event.Status, models.EscrowReconciliationStatusActivationFailed)
	}
	if event.LastError == "" {
		t.Fatal("expected last_error on failed activation event")
	}
}

func createActivationFixture(t *testing.T) (models.Order, models.Session, models.ProviderNode) {
	t.Helper()

	provider := testutil.CreateTestUser(t, testutil.UniqueEmail("activation_provider"), "provider")
	buyer := testutil.CreateTestUser(t, testutil.UniqueEmail("activation_buyer"), "buyer")

	nodeID := uuid.New()
	node := models.ProviderNode{
		ID:        nodeID,
		UserID:    provider.ID,
		Name:      "activation-node",
		Status:    models.NodeOnline,
		IsHealthy: true,
		IPAddress: "10.0.0.5",
		Port:      1080,
	}
	if err := db.DB.Create(&node).Error; err != nil {
		t.Fatalf("create provider node: %v", err)
	}

	listing := models.ProxyListing{
		SellerID:             provider.ID,
		ProviderNodeID:       &nodeID,
		Title:                "Activation listing",
		PricePerGB:           1,
		AvailableBandwidthGB: 10,
		Status:               models.ListingStatusActive,
		Country:              "GH",
		ISP:                  "Example ISP",
	}
	if err := db.DB.Create(&listing).Error; err != nil {
		t.Fatalf("create listing: %v", err)
	}

	sessionID := uuid.New()
	session := models.Session{
		ID:              sessionID,
		UserID:          buyer.ID,
		NodeID:          &nodeID,
		ListingID:       &listing.ID,
		Type:            models.SessionRotating,
		Status:          models.SessionDisabled,
		CredentialsUser: "activation-user-" + uuid.NewString(),
		CredentialsPass: "activation-pass",
		BandwidthLimit:  1024,
		Config:          "{}",
	}
	if err := db.DB.Create(&session).Error; err != nil {
		t.Fatalf("create session: %v", err)
	}

	order := models.Order{
		BuyerID:     buyer.ID,
		SellerID:    provider.ID,
		ListingID:   listing.ID,
		BandwidthGB: 1,
		PricePerGB:  1,
		TotalPrice:  1,
		Status:      models.OrderStatusActive,
		SessionID:   &sessionID,
		EscrowPDA:   "escrow" + uuid.NewString()[:28],
	}
	if err := db.DB.Create(&order).Error; err != nil {
		t.Fatalf("create order: %v", err)
	}
	return order, session, node
}

func testContext() context.Context {
	return context.Background()
}

func TestEnsureSessionCredentialsPlaintext_recoversAfterBeforeUpdateEncrypt(t *testing.T) {
	prevEnc := models.CredentialEncryptFn
	prevDec := models.CredentialDecryptFn
	t.Cleanup(func() {
		models.CredentialEncryptFn = prevEnc
		models.CredentialDecryptFn = prevDec
	})

	models.CredentialEncryptFn = func(plaintext string) (string, error) {
		return "cipher:" + plaintext, nil
	}
	models.CredentialDecryptFn = func(ciphertext string) (string, error) {
		const prefix = "cipher:"
		if len(ciphertext) < len(prefix) || ciphertext[:len(prefix)] != prefix {
			return "", fmt.Errorf("bad ciphertext")
		}
		return ciphertext[len(prefix):], nil
	}

	session := &models.Session{
		CredentialsUser: "plain-user",
		CredentialsPass: "plain-pass",
	}
	// Simulate GORM Update hooks encrypting in-memory fields (BeforeSave).
	if err := session.BeforeSave(nil); err != nil {
		t.Fatalf("BeforeSave: %v", err)
	}
	if len(session.CredentialsUser) < 4 || session.CredentialsUser[:4] != "ENC:" {
		t.Fatalf("expected encrypted user, got %q", session.CredentialsUser)
	}

	if err := ensureSessionCredentialsPlaintext(session); err != nil {
		t.Fatalf("ensureSessionCredentialsPlaintext: %v", err)
	}
	if session.CredentialsUser != "plain-user" || session.CredentialsPass != "plain-pass" {
		t.Fatalf("got user=%q pass=%q", session.CredentialsUser, session.CredentialsPass)
	}
}

