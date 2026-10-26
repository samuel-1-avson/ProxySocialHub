package solana

import (
	"encoding/json"
	"testing"
)

func parseTx(t *testing.T, raw string) *TransactionResult {
	t.Helper()
	var tx TransactionResult
	if err := json.Unmarshal([]byte(raw), &tx); err != nil {
		t.Fatalf("unmarshal fixture: %v", err)
	}
	return &tx
}

// W-06 regression: a treasury balance increase WITHOUT a System transfer
// instruction (rent refund, fee rebate, program credit) must not credit.
// The old balance-delta verifier credited exactly this shape.
func TestVerifyDepositTransfers_P0_BalanceDeltaOnlyRejected(t *testing.T) {
	tx := parseTx(t, `{
		"slot": 1,
		"meta": {"err": null, "fee": 5000,
			"preBalances": [10000000000, 0],
			"postBalances": [8999995000, 1000000000],
			"innerInstructions": []},
		"transaction": {"signatures": ["s"], "message": {
			"accountKeys": [
				{"pubkey": "Sender111111111111111111111111111111111111", "signer": true, "writable": true},
				{"pubkey": "Treasury1111111111111111111111111111111111", "signer": false, "writable": true}],
			"instructions": [{"program": "memo", "programId": "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr", "parsed": null}]
		}}}`)
	if _, err := VerifyDepositTransfers(tx, "Treasury1111111111111111111111111111111111", ""); err == nil {
		t.Fatal("balance delta without a transfer instruction must not verify")
	}
}

// Happy path: instruction-level proof in integer lamports.
func TestVerifyDepositTransfers_P0_InstructionProof(t *testing.T) {
	tx := parseTx(t, `{
		"slot": 1,
		"meta": {"err": null, "fee": 5000,
			"preBalances": [10000000000, 0],
			"postBalances": [8999995000, 1000000000],
			"innerInstructions": []},
		"transaction": {"signatures": ["s"], "message": {
			"accountKeys": [
				{"pubkey": "Sender111111111111111111111111111111111111", "signer": true, "writable": true},
				{"pubkey": "Treasury1111111111111111111111111111111111", "signer": false, "writable": true}],
			"instructions": [{"program": "system", "programId": "11111111111111111111111111111111",
				"parsed": {"type": "transfer", "info": {"source": "Sender111111111111111111111111111111111111", "destination": "Treasury1111111111111111111111111111111111", "lamports": 1000000000}}}]
		}}}`)
	lamports, err := VerifyDepositTransfers(tx, "Treasury1111111111111111111111111111111111", "Sender111111111111111111111111111111111111")
	if err != nil || lamports != 1_000_000_000 {
		t.Fatalf("got %d, %v", lamports, err)
	}
	// Wrong expected source: legs from someone else must not count.
	if _, err := VerifyDepositTransfers(tx, "Treasury1111111111111111111111111111111111", "Other1111111111111111111111111111111111111"); err == nil {
		t.Fatal("transfer from unexpected source must not verify")
	}
	// Legacy float shim still agrees.
	ok, sol, err := VerifyTransferAmount(tx, "Treasury1111111111111111111111111111111111", 0)
	if !ok || err != nil || sol != 1.0 {
		t.Fatalf("legacy shim: %v %.6f %v", ok, sol, err)
	}
}

// CPI inner transfers count; recipient-as-fee-payer is rejected.
func TestVerifyDepositTransfers_P0_InnerAndFeePayer(t *testing.T) {
	tx := parseTx(t, `{
		"slot": 1,
		"meta": {"err": null, "fee": 5000,
			"preBalances": [10000000000, 0, 5000000000],
			"postBalances": [9999995000, 2000000000, 3000000000],
			"innerInstructions": [{"index": 0, "instructions": [
				{"program": "system", "programId": "11111111111111111111111111111111",
				 "parsed": {"type": "transfer", "info": {"source": "Pda111111111111111111111111111111111111111", "destination": "Treasury1111111111111111111111111111111111", "lamports": 2000000000}}}]}]},
		"transaction": {"signatures": ["s"], "message": {
			"accountKeys": [
				{"pubkey": "Sender111111111111111111111111111111111111", "signer": true, "writable": true},
				{"pubkey": "Treasury1111111111111111111111111111111111", "signer": false, "writable": true},
				{"pubkey": "Pda111111111111111111111111111111111111111", "signer": false, "writable": true}],
			"instructions": [{"program": "prog", "programId": "Prog11111111111111111111111111111111111111"}]
		}}}`)
	lamports, err := VerifyDepositTransfers(tx, "Treasury1111111111111111111111111111111111", "")
	if err != nil || lamports != 2_000_000_000 {
		t.Fatalf("inner transfer: got %d, %v", lamports, err)
	}
	if _, err := VerifyDepositTransfers(tx, "Sender111111111111111111111111111111111111", ""); err == nil {
		t.Fatal("fee payer as recipient must be rejected")
	}
}

// v0/ALT: recipient only in loadedAddresses must resolve safely, and a
// truncated balance array must error — never panic (old code indexed
// static keys only and could read out of range).
func TestVerifyDepositTransfers_P0_V0LoadedAddresses(t *testing.T) {
	tx := parseTx(t, `{
		"slot": 1,
		"meta": {"err": null, "fee": 5000,
			"preBalances": [10000000000, 0],
			"postBalances": [8999995000, 1000000000],
			"loadedAddresses": {"writable": ["Treasury1111111111111111111111111111111111"], "readonly": []},
			"innerInstructions": []},
		"transaction": {"signatures": ["s"], "message": {
			"accountKeys": [
				{"pubkey": "Sender111111111111111111111111111111111111", "signer": true, "writable": true}],
			"instructions": [{"program": "system", "programId": "11111111111111111111111111111111",
				"parsed": {"type": "transfer", "info": {"source": "Sender111111111111111111111111111111111111", "destination": "Treasury1111111111111111111111111111111111", "lamports": 1000000000}}}]
		}}}`)
	lamports, err := VerifyDepositTransfers(tx, "Treasury1111111111111111111111111111111111", "Sender111111111111111111111111111111111111")
	if err != nil || lamports != 1_000_000_000 {
		t.Fatalf("v0 loaded recipient: got %d, %v", lamports, err)
	}

	tx.Meta.PostBalances = tx.Meta.PostBalances[:1]
	if _, err := VerifyDepositTransfers(tx, "Treasury1111111111111111111111111111111111", ""); err == nil {
		t.Fatal("truncated balances must error, not panic/credit")
	}
}

// Legacy string account keys (json encoding) still parse; sender is the
// fee payer by construction.
func TestGetTransactionSender_P0_StringKeys(t *testing.T) {
	tx := parseTx(t, `{"slot":1,"meta":{"err":null},"transaction":{"signatures":["s"],"message":{"accountKeys":["Sender111111111111111111111111111111111111","Treasury1111111111111111111111111111111111"]}}}`)
	sender, err := GetTransactionSender(tx)
	if err != nil || sender != "Sender111111111111111111111111111111111111" {
		t.Fatalf("got %q, %v", sender, err)
	}
}
