package db

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/core/domain"
	"github.com/proxyhubb/control-api/internal/models"
)

// SessionRepository is a GORM-based implementation of ports.SessionRepository.
type SessionRepository struct{}

// NewSessionRepository returns a new SessionRepository.
func NewSessionRepository() *SessionRepository {
	return &SessionRepository{}
}

// CreateSession persists a new session entity to the database.
func (r *SessionRepository) CreateSession(ctx context.Context, session *domain.SessionEntity) error {
	sessionID, err := uuid.Parse(session.ID)
	if err != nil {
		return fmt.Errorf("invalid session id: %w", err)
	}
	buyerID, err := uuid.Parse(session.BuyerID)
	if err != nil {
		return fmt.Errorf("invalid buyer id: %w", err)
	}

	m := models.Session{
		ID:              sessionID,
		UserID:          buyerID,
		Type:            models.SessionRotating,
		Status:          models.SessionStatus(session.Status),
		BandwidthLimit:  session.BandwidthLimit,
		BytesUsed:       session.BytesUsed,
		StartTime:       session.StartTime,
		CreatedAt:       session.CreatedAt,
		CredentialsUser: session.CredentialsUser,
		CredentialsPass: session.CredentialsPass,
	}

	// Set optional ListingID
	if session.ListingID != "" {
		listingID, err := uuid.Parse(session.ListingID)
		if err == nil {
			m.ListingID = &listingID
		}
	}

	// Set optional NodeID (ProviderID)
	if session.ProviderID != "" {
		providerID, err := uuid.Parse(session.ProviderID)
		if err == nil {
			m.NodeID = &providerID
		}
	}

	return DB.WithContext(ctx).Create(&m).Error
}

// GetSessionByID fetches a session by its UUID string and maps it to a domain entity.
func (r *SessionRepository) GetSessionByID(ctx context.Context, id string) (*domain.SessionEntity, error) {
	sessionID, err := uuid.Parse(id)
	if err != nil {
		return nil, fmt.Errorf("invalid session id: %w", err)
	}

	var m models.Session
	if err := DB.WithContext(ctx).First(&m, "id = ?", sessionID).Error; err != nil {
		return nil, err
	}

	return modelToEntity(&m), nil
}

// UpdateSessionStatus updates the Status column of a session.
func (r *SessionRepository) UpdateSessionStatus(ctx context.Context, id string, status domain.SessionStatus) error {
	sessionID, err := uuid.Parse(id)
	if err != nil {
		return fmt.Errorf("invalid session id: %w", err)
	}

	var session models.Session
	if err := DB.WithContext(ctx).First(&session, "id = ?", sessionID).Error; err != nil {
		return err
	}

	nextStatus := modelSessionStatusFromDomain(status)
	if err := models.ValidateSessionStatusTransition(session.Status, nextStatus); err != nil {
		return err
	}

	return DB.WithContext(ctx).Model(&session).Update("status", nextStatus).Error
}

// UpdateUsage updates the BytesUsed column of a session.
func (r *SessionRepository) UpdateUsage(ctx context.Context, id string, bytes int64) error {
	sessionID, err := uuid.Parse(id)
	if err != nil {
		return fmt.Errorf("invalid session id: %w", err)
	}

	return DB.WithContext(ctx).Model(&models.Session{}).
		Where("id = ?", sessionID).
		Update("bytes_used", bytes).Error
}

// ListActiveSessions returns all sessions with status "active".
func (r *SessionRepository) ListActiveSessions(ctx context.Context) ([]*domain.SessionEntity, error) {
	var sessions []models.Session
	if err := DB.WithContext(ctx).
		Where("status = ?", models.SessionActive).
		Find(&sessions).Error; err != nil {
		return nil, err
	}

	entities := make([]*domain.SessionEntity, len(sessions))
	for i, s := range sessions {
		entities[i] = modelToEntity(&s)
	}
	return entities, nil
}

// modelToEntity maps a models.Session to a domain.SessionEntity.
func modelToEntity(m *models.Session) *domain.SessionEntity {
	entity := &domain.SessionEntity{
		ID:              m.ID.String(),
		BuyerID:         m.UserID.String(),
		Status:          domain.SessionStatus(m.Status),
		BytesUsed:       m.BytesUsed,
		BandwidthLimit:  m.BandwidthLimit,
		StartTime:       m.StartTime,
		CreatedAt:       m.CreatedAt,
		UpdatedAt:       time.Time{},
		CredentialsUser: m.CredentialsUser,
		CredentialsPass: m.CredentialsPass,
	}

	if m.ListingID != nil {
		entity.ListingID = m.ListingID.String()
	}
	if m.NodeID != nil {
		entity.ProviderID = m.NodeID.String()
	}

	return entity
}

func modelSessionStatusFromDomain(status domain.SessionStatus) models.SessionStatus {
	switch status {
	case domain.SessionCompleted, domain.SessionTerminated:
		return models.SessionTerminated
	case domain.SessionActive:
		return models.SessionActive
	default:
		return models.SessionStatus(status)
	}
}
