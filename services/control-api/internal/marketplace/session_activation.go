package marketplace

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/decentralization"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/proofs"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

const (
	SessionActivationEventSource = "session_activation"
	SessionActivationEventType   = "session_activation"
)

var sessionActivationAttemptsTotal = promauto.NewCounterVec(
	prometheus.CounterOpts{
		Name: "proxyhubb_session_activation_attempts_total",
		Help: "Total number of marketplace session activation attempts by result.",
	},
	[]string{"result"},
)

// ProviderRegistryGateHook is set from main to providergate.Check (Wave 3.1).
// Kept as a hook to avoid import cycles (solana ↔ marketplace).
var ProviderRegistryGateHook func(ctx context.Context, node *models.ProviderNode) error

// ActivateOrderSession enables gateway auth for a marketplace order after escrow is confirmed.
func ActivateOrderSession(ctx context.Context, orderID uuid.UUID) error {
	var order models.Order
	if err := db.DB.First(&order, "id = ?", orderID).Error; err != nil {
		return fmt.Errorf("order not found: %w", err)
	}
	if order.SessionID == nil {
		return fmt.Errorf("order %s has no linked session", orderID)
	}
	if order.Status != models.OrderStatusActive && order.Status != models.OrderStatusCompleted {
		return fmt.Errorf("order %s is not confirmed for session activation: %s", orderID, order.Status)
	}

	var session models.Session
	if err := db.DB.First(&session, "id = ?", *order.SessionID).Error; err != nil {
		return fmt.Errorf("session not found: %w", err)
	}

	// Escrow-backed orders can have their Redis session wiped (manual terminate,
	// reaper false-positive). Allow resurrect from terminated → disabled first.
	if session.Status == models.SessionTerminated {
		if err := db.DB.Model(&session).Updates(map[string]interface{}{
			"status":   models.SessionDisabled,
			"end_time": time.Time{},
		}).Error; err != nil {
			return fmt.Errorf("failed to reset terminated session for reactivation: %w", err)
		}
		session.Status = models.SessionDisabled
	}

	if err := transitionSessionActivationStatus(&session, models.SessionActivationPending); err != nil {
		return err
	}
	sessionActivationAttemptsTotal.WithLabelValues("pending").Inc()
	if err := RecordSessionActivationEvent(&order, &session, models.EscrowReconciliationStatusActivationPending, "redis_sync_pending", "", true); err != nil {
		return fmt.Errorf("failed to record session activation attempt: %w", err)
	}

	// GORM BeforeSave encrypts credentials in-place on the session struct even when
	// only status is updated. Re-decrypt so Redis is keyed by the plaintext username
	// buyers actually use (and password hash matches the credentials API).
	if err := ensureSessionCredentialsPlaintext(&session); err != nil {
		_ = transitionSessionActivationStatus(&session, models.SessionActivationFailed)
		sessionActivationAttemptsTotal.WithLabelValues("failed").Inc()
		_ = RecordSessionActivationEvent(&order, &session, models.EscrowReconciliationStatusActivationFailed, "credential_decrypt_failed", err.Error(), false)
		return fmt.Errorf("session activation failed: %w", err)
	}

	if err := syncSessionToRedis(ctx, &order, &session); err != nil {
		_ = transitionSessionActivationStatus(&session, models.SessionActivationFailed)
		sessionActivationAttemptsTotal.WithLabelValues("failed").Inc()
		_ = RecordSessionActivationEvent(&order, &session, models.EscrowReconciliationStatusActivationFailed, "redis_sync_failed", err.Error(), false)
		return fmt.Errorf("session activation failed: %w", err)
	}

	if err := transitionSessionActivationStatus(&session, models.SessionActive); err != nil {
		sessionActivationAttemptsTotal.WithLabelValues("failed").Inc()
		_ = RecordSessionActivationEvent(&order, &session, models.EscrowReconciliationStatusActivationFailed, "db_status_sync_failed", err.Error(), false)
		return err
	}
	sessionActivationAttemptsTotal.WithLabelValues("synced").Inc()
	if err := RecordSessionActivationEvent(&order, &session, models.EscrowReconciliationStatusActivationSynced, "redis_sync_succeeded", "", false); err != nil {
		return fmt.Errorf("failed to mark session activation synced: %w", err)
	}
	RefreshListingOccupancy(order.ListingID)
	return nil
}

func transitionSessionActivationStatus(session *models.Session, next models.SessionStatus) error {
	if session.Status == next {
		return nil
	}
	if err := models.ValidateSessionStatusTransition(session.Status, next); err != nil {
		return err
	}
	if err := db.DB.Model(session).Update("status", next).Error; err != nil {
		return fmt.Errorf("failed to update session status to %s: %w", next, err)
	}
	session.Status = next
	return nil
}

func syncSessionToRedis(ctx context.Context, order *models.Order, session *models.Session) error {
	if redisClient.Client == nil {
		return fmt.Errorf("redis client unavailable")
	}
	if err := ensureSessionCredentialsPlaintext(session); err != nil {
		return err
	}

	var buyer models.User
	if err := db.DB.First(&buyer, "id = ?", order.BuyerID).Error; err != nil {
		return fmt.Errorf("buyer profile not found: %w", err)
	}

	var listing models.ProxyListing
	if err := db.DB.First(&listing, "id = ?", order.ListingID).Error; err != nil {
		return fmt.Errorf("listing not found: %w", err)
	}

	node, err := loadSessionProviderNode(session, &listing)
	if err != nil {
		return err
	}
	if ProviderRegistryGateHook != nil {
		if err := ProviderRegistryGateHook(ctx, node); err != nil {
			return fmt.Errorf("session activation blocked: %w", err)
		}
	}

	sessionData := BuildRedisSessionData(order, session, &listing, node, &buyer)
	if err := AttachCredentialProof(sessionData, order, session); err != nil {
		return err
	}
	if err := AttachSessionCapability(sessionData, order, session, &listing); err != nil {
		return err
	}

	if err := redisClient.StoreSession(session.CredentialsUser, sessionData, 24*time.Hour); err != nil {
		return fmt.Errorf("redis session sync failed: %w", err)
	}
	return nil
}

// ensureSessionCredentialsPlaintext decrypts ENC:-prefixed credential fields in-place.
// Needed after GORM updates: BeforeSave encrypts the in-memory struct even when the
// SQL only touches non-credential columns.
func ensureSessionCredentialsPlaintext(session *models.Session) error {
	if session == nil {
		return fmt.Errorf("session is nil")
	}
	if err := session.DecryptCredentialsForGateway(); err != nil {
		return fmt.Errorf("decrypt session credentials: %w", err)
	}
	if session.CredentialsUser == "" || session.CredentialsPass == "" {
		return fmt.Errorf("session credentials missing after decrypt")
	}
	if len(session.CredentialsUser) > 4 && session.CredentialsUser[:4] == "ENC:" {
		return fmt.Errorf("session credentials_user still encrypted after decrypt")
	}
	return nil
}

// RecordSessionActivationEvent stores the durable activation state used by
// retry workers and operator dashboards.
func RecordSessionActivationEvent(order *models.Order, session *models.Session, status, reason, lastError string, incrementAttempt bool) error {
	if order == nil || session == nil {
		return fmt.Errorf("order and session are required")
	}
	if status == "" {
		status = models.EscrowReconciliationStatusActivationPending
	}
	now := time.Now()
	payloadBytes, err := json.Marshal(map[string]interface{}{
		"order_id":       order.ID.String(),
		"session_id":     session.ID.String(),
		"session_status": string(session.Status),
		"redis_key":      "session:" + session.CredentialsUser,
		"listing_id":     order.ListingID.String(),
		"buyer_id":       order.BuyerID.String(),
		"seller_id":      order.SellerID.String(),
	})
	if err != nil {
		return fmt.Errorf("failed to marshal activation event payload: %w", err)
	}

	escrowPDA := order.EscrowPDA
	if escrowPDA == "" {
		escrowPDA = "order:" + order.ID.String()
	}
	txSignature := order.TxSignature
	if txSignature == "" {
		txSignature = order.TxHash
	}

	var existing models.EscrowReconciliationEvent
	err = db.DB.Where(
		"source = ? AND event_type = ? AND escrow_pda = ? AND tx_signature = ?",
		SessionActivationEventSource,
		SessionActivationEventType,
		escrowPDA,
		txSignature,
	).First(&existing).Error
	if err == nil {
		updates := map[string]interface{}{
			"order_id":     order.ID,
			"status":       status,
			"reason":       reason,
			"last_error":   lastError,
			"payload":      datatypes.JSON(payloadBytes),
			"last_seen_at": now,
			"updated_at":   now,
		}
		if incrementAttempt {
			updates["attempts"] = gorm.Expr("attempts + ?", 1)
		}
		if status == models.EscrowReconciliationStatusActivationSynced {
			updates["resolved_at"] = now
		} else {
			updates["resolved_at"] = nil
		}
		return db.DB.Model(&existing).Updates(updates).Error
	}
	if err != gorm.ErrRecordNotFound {
		return err
	}

	event := models.EscrowReconciliationEvent{
		Source:      SessionActivationEventSource,
		EventType:   SessionActivationEventType,
		EscrowPDA:   escrowPDA,
		TxSignature: txSignature,
		OrderID:     &order.ID,
		Status:      status,
		Reason:      reason,
		LastError:   lastError,
		Attempts:    1,
		Payload:     datatypes.JSON(payloadBytes),
		FirstSeenAt: now,
		LastSeenAt:  now,
	}
	if status == models.EscrowReconciliationStatusActivationSynced {
		event.ResolvedAt = &now
	}
	return db.DB.Create(&event).Error
}

func loadSessionProviderNode(session *models.Session, listing *models.ProxyListing) (*models.ProviderNode, error) {
	if session.NodeID != nil && *session.NodeID != uuid.Nil {
		var node models.ProviderNode
		if err := db.DB.Where("id = ? AND user_id = ? AND deleted_at IS NULL", *session.NodeID, listing.SellerID).
			First(&node).Error; err == nil {
			return &node, nil
		}
		var mirror models.Node
		if err := db.DB.Where("id = ? AND deleted_at IS NULL", *session.NodeID).First(&mirror).Error; err == nil &&
			mirror.ProviderNodeID != nil {
			if err := db.DB.Where("id = ? AND user_id = ? AND deleted_at IS NULL", *mirror.ProviderNodeID, listing.SellerID).
				First(&node).Error; err == nil {
				return &node, nil
			}
		}
	}
	return ResolveListingProviderNode(listing)
}

// BuildRedisSessionData constructs gateway session metadata for marketplace purchases.
func BuildRedisSessionData(order *models.Order, session *models.Session, listing *models.ProxyListing, node *models.ProviderNode, buyer *models.User) *redisClient.SessionData {
	data := &redisClient.SessionData{
		UserID:                 order.BuyerID.String(),
		SessionID:              session.ID.String(),
		ProviderID:             order.SellerID.String(),
		Type:                   string(session.Type),
		Status:                 "active",
		BandwidthLimit:         session.BandwidthLimit,
		BandwidthUsed:          session.BytesUsed,
		TrustTier:              string(buyer.TrustTier),
		TargetGeo:              listing.Country,
		TargetISP:              listing.ISP,
		ListingID:              listing.ID.String(),
		NodeID:                 GatewayRoutingNodeID(node),
		NodeHost:               node.IPAddress,
		NodePort:               node.Port,
		PricePerGB:             listing.PricePerGB,
		CredentialPasswordHash: HashCredentialPassword(session.CredentialsPass),
		OrderID:                order.ID.String(),
		ExpiresAt:              time.Now().Add(24 * time.Hour),
		CreatedAt:              time.Now(),
	}
	// Best-effort attach when callers ignore the error (tests / observe). Prefer Attach* helpers.
	_ = AttachCredentialProof(data, order, session)
	_ = AttachSessionCapability(data, order, session, listing)
	return data
}

// AttachCredentialProof binds a Wave 3.3 / W5.C.2 HMAC artifact into the Redis session blob.
// Enforce mode fail-closes when the artifact cannot be built (missing secret / ids).
func AttachCredentialProof(data *redisClient.SessionData, order *models.Order, session *models.Session) error {
	if data == nil || order == nil || session == nil {
		return fmt.Errorf("credential proof: missing session inputs")
	}
	if !decentralization.CredentialProofEnabled() {
		return nil
	}
	if err := ensureSessionCredentialsPlaintext(session); err != nil && decentralization.CredentialProofEnforce() {
		return fmt.Errorf("credential proof: %w", err)
	}
	issued := time.Now().UTC().Unix()
	expires := issued + 24*3600
	if !data.ExpiresAt.IsZero() {
		expires = data.ExpiresAt.UTC().Unix()
	}
	art := proofs.BuildOrderCredentialArtifact(proofs.OrderCredentialPayload{
		OrderID:      order.ID,
		SessionID:    session.ID,
		BuyerID:      order.BuyerID,
		ListingID:    order.ListingID,
		UsernameHash: proofs.HashCredentialsUsername(session.CredentialsUser),
		IssuedAt:     issued,
		ExpiresAt:    expires,
	}, decentralization.CredentialProofMode())
	if art == nil || art.Signature == "" || art.SignerKind == "none" {
		if decentralization.CredentialProofEnforce() {
			return fmt.Errorf("credential proof enforce: could not build HMAC artifact (SESSION_SECRET/GATEWAY_SHARED_SECRET required)")
		}
		return nil
	}
	data.OrderID = order.ID.String()
	data.CredentialProofUsernameHash = art.UsernameHash
	data.CredentialProofPayloadHash = art.PayloadHash
	data.CredentialProofSignature = art.Signature
	data.CredentialProofIssuedAt = art.IssuedAt
	data.CredentialProofExpiresAt = art.ExpiresAt
	return nil
}

// AttachSessionCapability binds a Wave 7.A Ed25519 capability into the Redis session blob.
// Enforce mode fail-closes when the signing key is missing or the token cannot be built.
func AttachSessionCapability(data *redisClient.SessionData, order *models.Order, session *models.Session, listing *models.ProxyListing) error {
	if data == nil || order == nil || session == nil {
		return fmt.Errorf("session capability: missing session inputs")
	}
	if !decentralization.SessionCapabilityEnabled() {
		return nil
	}
	if err := ensureSessionCredentialsPlaintext(session); err != nil && decentralization.SessionCapabilityEnforce() {
		return fmt.Errorf("session capability: %w", err)
	}
	secret := proofs.SessionCapabilitySigningSecret()
	if secret == "" {
		if decentralization.SessionCapabilityEnforce() {
			return fmt.Errorf("session capability enforce: PROXYHUB_SESSION_CAPABILITY_SIGNING_KEY required")
		}
		return nil
	}
	issued := time.Now().UTC().Unix()
	expires := issued + 24*3600
	if !data.ExpiresAt.IsZero() {
		expires = data.ExpiresAt.UTC().Unix()
	}
	offerHash := ""
	if listing != nil {
		offerHash = strings.TrimSpace(listing.ListingOfferHash)
		if offerHash == "" {
			offerHash = listing.ID.String()
		}
	}
	if offerHash == "" {
		offerHash = order.ListingID.String()
	}
	opPub := proofs.SessionCapabilityOperatorPubkey()
	payload := proofs.SessionCapabilityPayload{
		SessionID:      session.ID.String(),
		OfferHash:      offerHash,
		BuyerID:        order.BuyerID.String(),
		ExpiresAt:      expires,
		BandwidthLimit: session.BandwidthLimit,
		OperatorPubkey: opPub,
		UsernameHash:   proofs.HashCredentialsUsername(session.CredentialsUser),
		IssuedAt:       issued,
	}
	sig, issuerPub, err := proofs.SignSessionCapability(payload, secret)
	if err != nil {
		if decentralization.SessionCapabilityEnforce() {
			return fmt.Errorf("session capability enforce: %w", err)
		}
		return nil
	}
	if payload.OperatorPubkey == "" {
		payload.OperatorPubkey = issuerPub
	}
	data.CapabilityVersion = proofs.SessionCapabilityVersion
	data.CapabilityOfferHash = payload.OfferHash
	data.CapabilityBuyerID = payload.BuyerID
	data.CapabilityExpiresAt = payload.ExpiresAt
	data.CapabilityBandwidthLimit = payload.BandwidthLimit
	data.CapabilityOperatorPubkey = payload.OperatorPubkey
	data.CapabilityUsernameHash = payload.UsernameHash
	data.CapabilityIssuedAt = payload.IssuedAt
	data.CapabilitySignature = sig
	data.CapabilityIssuerPubkey = issuerPub
	if wire, encErr := proofs.EncodeSessionCapabilityToken(payload, sig, issuerPub); encErr == nil {
		data.CapabilityToken = wire
	}
	return nil
}

// IssueSessionCapabilityToken mints a W7.C CONNECT password (phubb1.…). Empty when mode is off.
func IssueSessionCapabilityToken(order *models.Order, session *models.Session, listing *models.ProxyListing) (string, error) {
	if !decentralization.SessionCapabilityEnabled() {
		return "", nil
	}
	data := &redisClient.SessionData{}
	if session != nil && session.BandwidthLimit > 0 {
		data.BandwidthLimit = session.BandwidthLimit
	}
	if err := AttachSessionCapability(data, order, session, listing); err != nil {
		return "", err
	}
	return data.CapabilityToken, nil
}
