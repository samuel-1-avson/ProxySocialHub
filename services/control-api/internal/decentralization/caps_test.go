package decentralization

import "testing"

// W-27: caps come from one config and must be coherent.
func TestMoneyCaps_P1_DefaultsAlign(t *testing.T) {
	t.Setenv("ORACLE_MAX_SINGLE_TRANSFER_SOL", "")
	t.Setenv("ORACLE_MAX_HOURLY_OUTFLOW_SOL", "")
	t.Setenv("WITHDRAW_API_CAP_SOL", "")
	caps, err := MoneyCaps()
	if err != nil {
		t.Fatalf("defaults: %v", err)
	}
	if caps.WithdrawAPICapSOL != caps.MaxSingleTransferSOL {
		t.Fatalf("withdraw cap must default to single-transfer cap: %+v", caps)
	}
}

func TestMoneyCaps_P1_IncoherentRejected(t *testing.T) {
	t.Setenv("ORACLE_MAX_SINGLE_TRANSFER_SOL", "50")
	t.Setenv("ORACLE_MAX_HOURLY_OUTFLOW_SOL", "500")
	t.Setenv("WITHDRAW_API_CAP_SOL", "10000") // old binding: API promised what guard rejects
	if _, err := MoneyCaps(); err == nil {
		t.Fatal("withdraw cap above velocity single cap must be rejected")
	}

	t.Setenv("WITHDRAW_API_CAP_SOL", "50")
	t.Setenv("ORACLE_MAX_HOURLY_OUTFLOW_SOL", "10") // hourly < single
	if _, err := MoneyCaps(); err == nil {
		t.Fatal("hourly below single must be rejected")
	}

	t.Setenv("ORACLE_MAX_HOURLY_OUTFLOW_SOL", "not-a-number")
	if _, err := MoneyCaps(); err == nil {
		t.Fatal("non-numeric cap must be rejected (typos fail boot, P0-8)")
	}
}
