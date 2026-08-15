package solana

import (
	"testing"
)

func TestReputationProgramIDDefaults(t *testing.T) {
	t.Setenv("REPUTATION_PROGRAM_ID", "")
	if got := ReputationProgramID(); got != DefaultReputationProgramID {
		t.Fatalf("got %s want %s", got, DefaultReputationProgramID)
	}
	// Misconfig: same as proxyhub must not stick.
	t.Setenv("REPUTATION_PROGRAM_ID", DefaultProgramID)
	if got := ReputationProgramID(); got != DefaultReputationProgramID {
		t.Fatalf("proxyhub collision: got %s", got)
	}
	t.Setenv("REPUTATION_PROGRAM_ID", "CustomRep111111111111111111111111111111111")
	if got := ReputationProgramID(); got != "CustomRep111111111111111111111111111111111" {
		t.Fatalf("custom override failed: %s", got)
	}
}

func TestEncodeVerifyUsageDataLayout(t *testing.T) {
	var root, proof [32]byte
	root[0], proof[0] = 0x11, 0x22
	data := EncodeVerifyUsageData(root, proof, 999)
	if len(data) != 80 {
		t.Fatalf("len=%d want 80", len(data))
	}
	if data[8] != 0x11 || data[40] != 0x22 {
		t.Fatal("root/proof placement wrong")
	}
}

func TestEncodeInitializeProviderForData(t *testing.T) {
	data := EncodeInitializeProviderForData()
	if len(data) != 8 {
		t.Fatalf("len=%d want 8", len(data))
	}
	if data[0] == 0 && data[1] == 0 && data[2] == 0 && data[3] == 0 {
		t.Fatal("discriminator should be non-zero")
	}
}

func TestAggregateProviderBatchCredits(t *testing.T) {
	got := AggregateProviderBatchCredits([]ProviderBatchCredit{
		{Wallet: "Aaa", TotalBytes: 10},
		{Wallet: "Bbb", TotalBytes: 5},
		{Wallet: "Aaa", TotalBytes: 7},
		{Wallet: "", TotalBytes: 99},
		{Wallet: "Bbb", TotalBytes: 0},
	})
	if len(got) != 2 {
		t.Fatalf("len=%d want 2: %+v", len(got), got)
	}
	if got[0].Wallet != "Aaa" || got[0].TotalBytes != 17 {
		t.Fatalf("Aaa credit=%+v", got[0])
	}
	if got[1].Wallet != "Bbb" || got[1].TotalBytes != 5 {
		t.Fatalf("Bbb credit=%+v", got[1])
	}
}

func TestGateReputationScoreUpdateRespectsGroth16(t *testing.T) {
	t.Setenv("PROXYHUB_ZK_ONCHAIN_GROTH16", "")
	if err := GateReputationScoreUpdate(); err != nil {
		t.Fatalf("flag off should allow: %v", err)
	}
	t.Setenv("PROXYHUB_ZK_ONCHAIN_GROTH16", "true")
	if err := GateReputationScoreUpdate(); err == nil {
		t.Fatal("flag on must fail-closed until ready")
	}
}

func TestReputationStatusMetaNoPlaceholder(t *testing.T) {
	t.Setenv("REPUTATION_PROGRAM_ID", "")
	m := ReputationStatusMeta()
	if m["placeholder"] == true {
		t.Fatal("Wave 4.2 default must not be placeholder")
	}
	if m["program_id"] != DefaultReputationProgramID {
		t.Fatalf("program_id=%v", m["program_id"])
	}
}
