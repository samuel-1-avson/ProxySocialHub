package billing

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func TestMarkSettlementArtifactsSettledAdvancesSessionIntentLifecycle(t *testing.T) {
	testutil.SetupTestDB(t)

	if err := db.DB.AutoMigrate(&models.UsageReceipt{}, &models.SettlementManifest{}, &models.SessionIntentRecord{}); err != nil {
		t.Fatalf("auto migrate settlement models: %v", err)
	}

	userID := uuid.New()
	now := time.Now().UTC()
	session := models.Session{
		UserID:    userID,
		Type:      models.SessionRotating,
		Status:    models.SessionActive,
		Config:    "{}",
		StartTime: now.Add(-10 * time.Minute),
		EndTime:   now.Add(50 * time.Minute),
	}
	if err := db.DB.Create(&session).Error; err != nil {
		t.Fatalf("create session: %v", err)
	}
	sessionUsername := "settlement-session-user-" + session.ID.String()

	manifest := models.SettlementManifest{
		SessionID:       session.ID,
		SessionUsername: sessionUsername,
		UserRef:         userID.String(),
		WindowKey:       "window-" + session.ID.String(),
		WindowStartedAt: time.Now().Add(-5 * time.Minute).UTC(),
		WindowEndedAt:   time.Now().Add(-1 * time.Minute).UTC(),
		LastReceiptAt:   time.Now().Add(-1 * time.Minute).UTC(),
		Status:          models.SettlementManifestOpen,
	}
	if err := db.DB.Create(&manifest).Error; err != nil {
		t.Fatalf("create settlement manifest: %v", err)
	}

	receipt := models.UsageReceipt{
		ManifestID:      &manifest.ID,
		SessionID:       session.ID,
		SessionUsername: sessionUsername,
		UserRef:         userID.String(),
		BytesUp:         512,
		BytesDown:       1024,
		Nonce:           1,
		Signature:       "sig-1",
		Source:          "gateway_report",
		Status:          models.UsageReceiptPending,
		ReportedAt:      time.Now().Add(-2 * time.Minute).UTC(),
	}
	if err := db.DB.Create(&receipt).Error; err != nil {
		t.Fatalf("create usage receipt: %v", err)
	}

	intent := models.SessionIntentRecord{
		UserID:         userID,
		SessionType:    models.SessionRotating,
		LifecycleState: models.SessionIntentClosing,
		ExpiresAt:      time.Now().Add(30 * time.Minute).UTC(),
		ClosingAt:      pointerTime(time.Now().Add(-3 * time.Minute).UTC()),
		CreatedAt:      time.Now().Add(-10 * time.Minute).UTC(),
		UpdatedAt:      time.Now().Add(-2 * time.Minute).UTC(),
	}
	if err := db.DB.Create(&intent).Error; err != nil {
		t.Fatalf("create session intent: %v", err)
	}

	if err := markSettlementArtifactsSettled(session.ID); err != nil {
		t.Fatalf("mark settlement artifacts settled: %v", err)
	}

	var refreshedReceipt models.UsageReceipt
	if err := db.DB.First(&refreshedReceipt, "id = ?", receipt.ID).Error; err != nil {
		t.Fatalf("reload usage receipt: %v", err)
	}
	if refreshedReceipt.Status != models.UsageReceiptSettled || refreshedReceipt.SettledAt == nil {
		t.Fatalf("expected usage receipt to be settled, got status=%q settled_at=%v", refreshedReceipt.Status, refreshedReceipt.SettledAt)
	}

	var refreshedManifest models.SettlementManifest
	if err := db.DB.First(&refreshedManifest, "id = ?", manifest.ID).Error; err != nil {
		t.Fatalf("reload settlement manifest: %v", err)
	}
	if refreshedManifest.Status != models.SettlementManifestSettled || refreshedManifest.SettledAt == nil {
		t.Fatalf("expected settlement manifest to be settled, got status=%q settled_at=%v", refreshedManifest.Status, refreshedManifest.SettledAt)
	}

	var refreshedIntent models.SessionIntentRecord
	if err := db.DB.First(&refreshedIntent, "id = ?", intent.ID).Error; err != nil {
		t.Fatalf("reload session intent: %v", err)
	}
	if refreshedIntent.LifecycleState != models.SessionIntentArchived {
		t.Fatalf("expected session intent to be archived, got %q", refreshedIntent.LifecycleState)
	}
	if refreshedIntent.LedgerCommittedAt == nil || refreshedIntent.BatchedAt == nil || refreshedIntent.ChainCommittedAt == nil || refreshedIntent.ArchivedAt == nil {
		t.Fatalf(
			"expected settlement timestamps to be populated, got ledger=%v batched=%v chain=%v archived=%v",
			refreshedIntent.LedgerCommittedAt,
			refreshedIntent.BatchedAt,
			refreshedIntent.ChainCommittedAt,
			refreshedIntent.ArchivedAt,
		)
	}
}

func pointerTime(value time.Time) *time.Time {
	return &value
}
