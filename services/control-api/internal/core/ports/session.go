package ports

import (
	"context"

	"github.com/proxyhubb/control-api/internal/core/domain"
)

// SessionRepository is the outbound port for session persistence
type SessionRepository interface {
	CreateSession(ctx context.Context, session *domain.SessionEntity) error
	GetSessionByID(ctx context.Context, id string) (*domain.SessionEntity, error)
	UpdateSessionStatus(ctx context.Context, id string, status domain.SessionStatus) error
	UpdateUsage(ctx context.Context, id string, bytes int64) error
	ListActiveSessions(ctx context.Context) ([]*domain.SessionEntity, error)
}

// ProxyGateway is the outbound port for interacting with provider nodes
type ProxyGateway interface {
	ProvisionSession(ctx context.Context, session *domain.SessionEntity) error
	TerminateSession(ctx context.Context, sessionID string) error
	VerifyHealth(ctx context.Context, providerID string) (bool, error)
}

// SessionService is the inbound port used by the API layer
type SessionService interface {
	InitializeSession(ctx context.Context, buyerID, listingID string, bandwidthLimit int64) (*domain.SessionEntity, error)
	TerminateSession(ctx context.Context, sessionID string) error
	CloseCompletedSessions(ctx context.Context) error
}
