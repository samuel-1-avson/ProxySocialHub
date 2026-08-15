package settlement

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"testing"

	"github.com/google/uuid"
	"github.com/mr-tron/base58"
	"github.com/proxyhubb/control-api/internal/models"
)

func testSecret(t *testing.T) string {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return base58.Encode(priv.Seed())
}

func TestReceiptSoT(t *testing.T) {
	t.Setenv("PROXYHUB_SETTLEMENT_BUNDLE_PATH", "")
	t.Setenv("PROXYHUB_SETTLEMENT_BUNDLE_URL", "")
	t.Setenv("PROXYHUB_SETTLEMENT_BUNDLE_CID", "")
	if ReceiptSoT("") != "postgres" {
		t.Fatal("default postgres")
	}
	t.Setenv("PROXYHUB_SETTLEMENT_BUNDLE_PATH", "/tmp/settle.json")
	if ReceiptSoT("") != "postgres_cache" {
		t.Fatal("pinned must be postgres_cache")
	}
	if ReceiptSoT("3xSigDummyEscrowTx111111111111111111111111111111111") != "escrow_pda" {
		t.Fatal("escrow tx is SoT even when a bundle is pinned")
	}
}

func TestWouldBroadcastAlwaysFalse(t *testing.T) {
	t.Setenv("PROXYHUB_SETTLEMENT_BUNDLE_AUTO", "1")
	t.Setenv("PROXYHUB_SETTLEMENT_BUNDLE_CONFIRM", "1")
	if WouldBroadcast() {
		t.Fatal("W9.C must never broadcast SOL")
	}
	if ExecuteMode() != "gates_armed_observe_only" {
		t.Fatalf("mode: %s", ExecuteMode())
	}
}

func TestSignAndVerifyReceipt(t *testing.T) {
	secret := testSecret(t)
	m := &models.SettlementManifest{
		WindowKey:    "w1",
		SessionID:    uuid.MustParse("12345678-1234-1234-1234-123456789abc"),
		ReceiptCount: 2,
		TotalBytes:   4096,
		Status:       models.SettlementManifestSettled,
		UserRef:      "buyer",
		ProviderRef:  "seller",
	}
	r := FromManifest(m, "escrowTx1")
	if err := SignReceipt(&r, secret); err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(r)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := ParseReceipt(raw)
	if err != nil {
		t.Fatal(err)
	}
	if !VerifyReceipt(*parsed) {
		t.Fatal("verify failed")
	}
	parsed.TotalBytes++
	if VerifyReceipt(*parsed) {
		t.Fatal("tamper must fail")
	}
}

func TestParseReceiptRejectsWrongType(t *testing.T) {
	if _, err := ParseReceipt([]byte(`{"message_type":"NOPE"}`)); err == nil {
		t.Fatal("wrong type must fail")
	}
}

func TestEmitSampleReceiptVerifiesWithoutPostgres(t *testing.T) {
	t.Setenv("CONTROL_API_URL", "http://127.0.0.1:1")
	r, err := EmitSampleReceipt("", "")
	if err != nil {
		t.Fatal(err)
	}
	if !VerifyReceipt(r) {
		t.Fatal("sample receipt must verify without API/Postgres")
	}
	if WouldBroadcast() {
		t.Fatal("emit must not broadcast SOL")
	}
}
