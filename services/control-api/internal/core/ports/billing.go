package ports

import (
	"context"

	"github.com/proxyhubb/control-api/internal/core/domain"
)

// BillingRepository defines how billing data is persisted
type BillingRepository interface {
	IncrementPendingBalance(ctx context.Context, sessionID string, amount int64) error
	IncrementProviderEarnings(ctx context.Context, providerID string, amount int64) error
}

// SessionLookupPort defines how to retrieve session data for billing
type SessionLookupPort interface {
	GetSession(ctx context.Context, sessionID string) (*domain.SessionEntity, error)
	GetProviderPublicKey(ctx context.Context, providerID string) (string, error)
}

// BillingService defines the primary use cases for billing
type BillingService interface {
	ProcessUsage(ctx context.Context, usage domain.Usage, signature string, nonce uint64) error
}
