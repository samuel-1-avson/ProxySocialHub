package solana

import (
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	sol "github.com/gagliardetto/solana-go"
)

// P2-ABI-1 layout fixtures. Expected bytes and offsets come from the
// committed IDL snapshot (services/solana-programs/proxyhub/idl/proxyhub.json),
// which Anchor generated from the Rust program, not from the Go code under
// test.

func TestDecodeEscrowStatusReadsStatusNotLimit(t *testing.T) {
	// Full Escrow account: 8 disc + 32 buyer + 32 seller + 8 amount +
	// 8 bandwidth_limit_gb + 8 bandwidth_used_gb + 1 status + 8 created_at +
	// 8 expires_at + 32 price_oracle + 8 price_timestamp + 1 bump = 154.
	raw := make([]byte, 154)
	// bandwidth_limit_gb low byte (old buggy offset 80) = 2 (Settled)...
	binary.LittleEndian.PutUint64(raw[80:88], 2)
	// ...while the real status at offset 96 is Active (1).
	raw[96] = 1

	got, err := decodeEscrowStatus(raw)
	if err != nil {
		t.Fatalf("decodeEscrowStatus: %v", err)
	}
	if got != EscrowStatusActive {
		t.Fatalf("status = %d, want Active (1); the old offset read the limit low byte", got)
	}

	raw[96] = 2
	binary.LittleEndian.PutUint64(raw[80:88], 9)
	got, err = decodeEscrowStatus(raw)
	if err != nil {
		t.Fatalf("decodeEscrowStatus: %v", err)
	}
	if got != EscrowStatusSettled {
		t.Fatalf("status = %d, want Settled (2)", got)
	}

	if _, err := decodeEscrowStatus(make([]byte, 96)); err == nil {
		t.Fatal("short input: want error, got nil")
	}
}

func TestDecodeProgramConfigLayout(t *testing.T) {
	raw := make([]byte, 51)
	body := raw[8:]
	binary.LittleEndian.PutUint64(body[0:8], 100_000_000)   // kyc lamports
	binary.LittleEndian.PutUint16(body[8:10], 250)          // fee bps
	binary.LittleEndian.PutUint64(body[10:18], 5_000_000_000)
	binary.LittleEndian.PutUint64(body[18:26], 1<<40)
	binary.LittleEndian.PutUint64(body[26:34], 777)         // unstake cooldown
	binary.LittleEndian.PutUint64(body[34:42], 1_700_000_000)
	body[42] = 254 // bump

	cfg, err := decodeProgramConfig(raw, sol.PublicKey{})
	if err != nil {
		t.Fatalf("decodeProgramConfig: %v", err)
	}
	if cfg.KYCMinSOLLamports != 100_000_000 || cfg.PlatformFeeBPS != 250 ||
		cfg.MaxDailySpendLamports != 5_000_000_000 || cfg.MaxSessionBWBytes != 1<<40 {
		t.Fatalf("scalar fields decoded wrong: %+v", cfg)
	}
	if cfg.UnstakeCooldownSeconds != 777 {
		t.Fatalf("cooldown = %d, want 777", cfg.UnstakeCooldownSeconds)
	}
	if cfg.UpdatedAt != 1_700_000_000 {
		t.Fatalf("updated_at = %d, want 1700000000 (old decoder returned the cooldown)", cfg.UpdatedAt)
	}
	if _, err := decodeProgramConfig(make([]byte, 50), sol.PublicKey{}); err == nil {
		t.Fatal("short input: want error, got nil")
	}
}

// idlEventDiscriminators are copied from the committed IDL events section so
// the watcher is tested against Anchor's bytes, not its own hash helper.
var idlEventDiscriminators = map[string][]byte{
	"EscrowInitialized":   {222, 186, 157, 47, 145, 142, 176, 248},
	"EscrowSettled":       {97, 27, 150, 55, 203, 179, 173, 23},
	"EscrowRefunded":      {132, 209, 49, 109, 135, 138, 28, 81},
	"UsageProofSubmitted": {109, 44, 216, 169, 190, 22, 99, 69},
}

func eventLogLine(disc []byte, payload []byte) string {
	return "Program data: " + base64.StdEncoding.EncodeToString(append(append([]byte{}, disc...), payload...))
}

func key32(b byte) []byte {
	out := make([]byte, 32)
	for i := range out {
		out[i] = b
	}
	return out
}

func TestParseLogLineEscrowEvents(t *testing.T) {
	w := &Watcher{}

	// EscrowInitialized: escrow, buyer, seller, amount u64, limit_gb u64.
	p := append(append(append(key32(1), key32(2)...), key32(3)...), make([]byte, 16)...)
	binary.LittleEndian.PutUint64(p[96:104], 42_000)
	binary.LittleEndian.PutUint64(p[104:112], 7)
	ev := w.parseLogLine(eventLogLine(idlEventDiscriminators["EscrowInitialized"], p), "sig")
	if ev == nil || ev.Type != "initialized" || ev.Amount != 42_000 || ev.LimitGB != 7 ||
		ev.EscrowPDA != sol.PublicKeyFromBytes(key32(1)).String() {
		t.Fatalf("EscrowInitialized parsed as %+v", ev)
	}

	// EscrowSettled: escrow, seller_payout u64, buyer_refund u64, bandwidth_used u64.
	p = append(key32(1), make([]byte, 24)...)
	binary.LittleEndian.PutUint64(p[32:40], 90_000)
	binary.LittleEndian.PutUint64(p[40:48], 10_000)
	binary.LittleEndian.PutUint64(p[48:56], 5)
	ev = w.parseLogLine(eventLogLine(idlEventDiscriminators["EscrowSettled"], p), "sig")
	if ev == nil || ev.Type != "settled" || ev.Amount != 90_000 || ev.LimitGB != 5 {
		t.Fatalf("EscrowSettled parsed as %+v", ev)
	}

	// EscrowRefunded: escrow, buyer, amount u64.
	p = append(append(key32(1), key32(2)...), make([]byte, 8)...)
	binary.LittleEndian.PutUint64(p[64:72], 33_000)
	ev = w.parseLogLine(eventLogLine(idlEventDiscriminators["EscrowRefunded"], p), "sig")
	if ev == nil || ev.Type != "refunded" || ev.Amount != 33_000 ||
		ev.Buyer != sol.PublicKeyFromBytes(key32(2)).String() {
		t.Fatalf("EscrowRefunded parsed as %+v", ev)
	}

	// UsageProofSubmitted: escrow, proof_record, proof_index u32,
	// total_bytes u64, period_start i64, period_end i64 (92 bytes total).
	p = make([]byte, 92)
	copy(p[0:32], key32(1))
	copy(p[32:64], key32(9))
	binary.LittleEndian.PutUint32(p[64:68], 3)
	binary.LittleEndian.PutUint64(p[68:76], 1_234_567)
	ev = w.parseLogLine(eventLogLine(idlEventDiscriminators["UsageProofSubmitted"], p), "sig")
	if ev == nil || ev.Type != "usage_proof_submitted" || ev.Amount != 1_234_567 ||
		ev.Seller != sol.PublicKeyFromBytes(key32(9)).String() {
		t.Fatalf("UsageProofSubmitted parsed as %+v", ev)
	}
}

type abiIDLEventsDoc struct {
	Events []struct {
		Name          string `json:"name"`
		Discriminator []byte `json:"discriminator"`
	} `json:"events"`
}

func TestEventDiscriminatorsMatchCommittedIDL(t *testing.T) {
	raw, err := os.ReadFile(filepath.Clean(committedIDLPath))
	if err != nil {
		t.Fatalf("read committed IDL: %v", err)
	}
	var doc abiIDLEventsDoc
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("parse committed IDL: %v", err)
	}
	byName := make(map[string][]byte, len(doc.Events))
	for _, e := range doc.Events {
		byName[e.Name] = e.Discriminator
	}
	for _, name := range []string{
		"EscrowInitialized", "EscrowSettled", "EscrowRefunded",
		"UsageProofSubmitted", "CircleRegisteredEvent", "CircleSettledEvent",
	} {
		disc, ok := byName[name]
		if !ok {
			t.Errorf("%s: missing from committed IDL events", name)
			continue
		}
		if got := getEventDiscriminator(name); got != hex.EncodeToString(disc) {
			t.Errorf("%s: watcher discriminator %s, IDL %s", name, got, hex.EncodeToString(disc))
		}
	}
}
