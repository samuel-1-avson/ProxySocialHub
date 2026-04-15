package sessionintent

import (
	"time"

	"github.com/proxyhubb/control-api/internal/models"
)

func IsSupportedGatewayLifecycle(state models.SessionIntentLifecycle) bool {
	switch state {
	case models.SessionIntentRouted,
		models.SessionIntentActive,
		models.SessionIntentClosing,
		models.SessionIntentLedgerCommitted,
		models.SessionIntentExpired:
		return true
	default:
		return false
	}
}

func IsSupportedSettlementLifecycle(state models.SessionIntentLifecycle) bool {
	switch state {
	case models.SessionIntentLedgerCommitted,
		models.SessionIntentBatched,
		models.SessionIntentChainCommitted,
		models.SessionIntentArchived:
		return true
	default:
		return false
	}
}

func CanAdvanceGatewayLifecycle(from models.SessionIntentLifecycle, to models.SessionIntentLifecycle) bool {
	if from == to {
		return true
	}

	switch from {
	case models.SessionIntentAuthorized:
		return to == models.SessionIntentRouted || to == models.SessionIntentActive || to == models.SessionIntentExpired
	case models.SessionIntentRouted:
		return to == models.SessionIntentActive || to == models.SessionIntentClosing || to == models.SessionIntentExpired
	case models.SessionIntentActive:
		return to == models.SessionIntentClosing || to == models.SessionIntentLedgerCommitted || to == models.SessionIntentExpired
	case models.SessionIntentClosing:
		return to == models.SessionIntentLedgerCommitted || to == models.SessionIntentExpired
	case models.SessionIntentLedgerCommitted:
		return false
	case models.SessionIntentExpired, models.SessionIntentArchived:
		return false
	default:
		return false
	}
}

func CanAdvanceSettlementLifecycle(from models.SessionIntentLifecycle, to models.SessionIntentLifecycle) bool {
	if from == to {
		return true
	}

	switch from {
	case models.SessionIntentLedgerCommitted:
		return to == models.SessionIntentBatched
	case models.SessionIntentBatched:
		return to == models.SessionIntentChainCommitted
	case models.SessionIntentChainCommitted:
		return to == models.SessionIntentArchived
	default:
		return false
	}
}

func ApplyLifecycleTransition(
	record *models.SessionIntentRecord,
	updates map[string]interface{},
	next models.SessionIntentLifecycle,
	now time.Time,
) {
	updates["lifecycle_state"] = next

	switch next {
	case models.SessionIntentRouted:
		if record.RoutedAt == nil {
			updates["routed_at"] = now
		}
	case models.SessionIntentActive:
		if record.ActivatedAt == nil {
			updates["activated_at"] = now
		}
	case models.SessionIntentClosing:
		if record.ClosingAt == nil {
			updates["closing_at"] = now
		}
	case models.SessionIntentLedgerCommitted:
		if record.LedgerCommittedAt == nil {
			updates["ledger_committed_at"] = now
		}
	case models.SessionIntentBatched:
		if record.BatchedAt == nil {
			updates["batched_at"] = now
		}
	case models.SessionIntentChainCommitted:
		if record.ChainCommittedAt == nil {
			updates["chain_committed_at"] = now
		}
	case models.SessionIntentArchived:
		if record.ArchivedAt == nil {
			updates["archived_at"] = now
		}
	case models.SessionIntentExpired:
		if record.ExpiredAt == nil {
			updates["expired_at"] = now
		}
	}
}
