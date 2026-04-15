package api

import (
	"time"

	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/sessionintent"
)

func isSupportedGatewaySessionIntentLifecycle(state models.SessionIntentLifecycle) bool {
	return sessionintent.IsSupportedGatewayLifecycle(state)
}

func isSupportedSettlementSessionIntentLifecycle(state models.SessionIntentLifecycle) bool {
	return sessionintent.IsSupportedSettlementLifecycle(state)
}

func canAdvanceGatewaySessionIntentLifecycle(from models.SessionIntentLifecycle, to models.SessionIntentLifecycle) bool {
	return sessionintent.CanAdvanceGatewayLifecycle(from, to)
}

func canAdvanceSettlementSessionIntentLifecycle(from models.SessionIntentLifecycle, to models.SessionIntentLifecycle) bool {
	return sessionintent.CanAdvanceSettlementLifecycle(from, to)
}

func applySessionIntentLifecycleTransition(
	record *models.SessionIntentRecord,
	updates map[string]interface{},
	next models.SessionIntentLifecycle,
	now time.Time,
) {
	sessionintent.ApplyLifecycleTransition(record, updates, next, now)
}
