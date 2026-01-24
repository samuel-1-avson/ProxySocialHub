package services

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/core/domain"
	"github.com/proxyhubb/control-api/internal/core/ports"
	"github.com/proxyhubb/control-api/internal/nats"
)

type SessionServiceImpl struct {
	repo ports.SessionRepository
}

func NewSessionService(repo ports.SessionRepository) *SessionServiceImpl {
	return &SessionServiceImpl{
		repo: repo,
	}
}

// InitializeSession handles the logic to start a new proxy connection
func (s *SessionServiceImpl) InitializeSession(ctx context.Context, buyerID, listingID string, bandwidthLimit int64) (*domain.SessionEntity, error) {
	// 1. Create domain entity
	session := &domain.SessionEntity{
		ID:             uuid.New().String(),
		BuyerID:        buyerID,
		ListingID:      listingID,
		Status:         domain.SessionPending,
		BandwidthLimit: bandwidthLimit,
		CreatedAt:      time.Now(),
		UpdatedAt:      time.Now(),
	}

	// 2. Fetch Listing/Provider details (Simplified lookup)
	session.PricePerHour = 0.1 // Default
	session.ProviderID = "mock-provider-id"

	// 3. Persist Pending Session
	if err := s.repo.CreateSession(ctx, session); err != nil {
		return nil, fmt.Errorf("failed to save session: %w", err)
	}

	// 4. Publish Event to NATS
	event := domain.SessionCreatedEvent{
		SessionID:      session.ID,
		BuyerID:        session.BuyerID,
		ProviderID:     session.ProviderID,
		ListingID:      session.ListingID,
		BandwidthLimit: session.BandwidthLimit,
		Timestamp:      time.Now(),
	}

	payload, _ := json.Marshal(event)
	_, err := nats.JS.Publish(ctx, "proxy.sessions.v1.created", payload)
	if err != nil {
		return nil, fmt.Errorf("failed to queue provisioning: %w", err)
	}

	return session, nil
}

// TerminateSession handles clean closure via events
func (s *SessionServiceImpl) TerminateSession(ctx context.Context, sessionID string) error {
	session, err := s.repo.GetSessionByID(ctx, sessionID)
	if err != nil {
		return err
	}

	if session.Status != domain.SessionActive {
		return fmt.Errorf("cannot terminate non-active session: %s", session.Status)
	}

	// 1. Publish Termination Event
	event := domain.SessionTerminatedEvent{
		SessionID: sessionID,
		Timestamp: time.Now(),
	}
	payload, _ := json.Marshal(event)
	_, err = nats.JS.Publish(ctx, "proxy.sessions.v1.terminated", payload)
	if err != nil {
		return fmt.Errorf("failed to queue termination: %w", err)
	}

	// 2. Optimistically update DB (Worker will confirm)
	return s.repo.UpdateSessionStatus(ctx, sessionID, domain.SessionCompleted)
}

// CloseCompletedSessions is a background task helper
func (s *SessionServiceImpl) CloseCompletedSessions(ctx context.Context) error {
	active, err := s.repo.ListActiveSessions(ctx)
	if err != nil {
		return err
	}

	for _, session := range active {
		if session.IsExhausted() {
			_ = s.TerminateSession(ctx, session.ID)
		}
	}
	return nil
}
