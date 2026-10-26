package solana

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// committedIDLPath is the repo's canonical IDL snapshot, regenerated with
// `anchor build` in services/solana-programs/proxyhub (P1-SC-6). The Go
// instruction builders in this package are hand-written, so this test pins
// their instruction names, discriminators and account order to the IDL that
// Anchor generated from the Rust program. Regenerate the snapshot whenever
// the program's account lists change, and update the expectations below in
// the same commit after checking each builder by hand.
const committedIDLPath = "../../../solana-programs/proxyhub/idl/proxyhub.json"

type idlAccountMeta struct {
	Name     string `json:"name"`
	Writable bool   `json:"writable"`
	Signer   bool   `json:"signer"`
}

type idlInstruction struct {
	Name          string           `json:"name"`
	Discriminator []byte           `json:"discriminator"`
	Accounts      []idlAccountMeta `json:"accounts"`
}

type idlFile struct {
	Address      string           `json:"address"`
	Instructions []idlInstruction `json:"instructions"`
}

func loadCommittedIDL(t *testing.T) map[string]idlInstruction {
	t.Helper()
	raw, err := os.ReadFile(filepath.Clean(committedIDLPath))
	if err != nil {
		t.Fatalf("read committed IDL: %v", err)
	}
	var doc idlFile
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("parse committed IDL: %v", err)
	}
	if doc.Address != "AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu" {
		t.Fatalf("IDL address = %q, want the proxyhub program id", doc.Address)
	}
	out := make(map[string]idlInstruction, len(doc.Instructions))
	for _, ix := range doc.Instructions {
		out[ix.Name] = ix
	}
	return out
}

// goBuilderAccounts lists, per instruction this package sends, the account
// names in the exact order the Go builder passes them. Transcribed from the
// builders during the P1-SC-6 audit; the IDL side comes from Anchor, so a
// mismatch here means Go and the program have drifted.
var goBuilderAccounts = map[string][]string{
	"stake_provider":            {"oracle", "stake_account", "system_program", "program_state"},
	"unstake_provider":          {"oracle", "stake_account", "program_state", "program_config"},
	"lock_session_commitment":   {"oracle", "session_commitment", "system_program", "program_state"},
	"create_proposal":           {"oracle", "proposal", "system_program", "program_state"},
	"open_dispute_onchain":      {"oracle", "escrow", "dispute_record", "system_program", "program_state"},
	"submit_review_attestation": {"oracle", "review_attestation", "system_program", "program_state"},
	"settle_escrow":             {"authority", "escrow", "buyer", "seller", "program_state"},
	"settle_session_escrow":     {"oracle", "session_escrow", "buyer", "seller", "program_state"},
	"submit_usage_proof":        {"oracle", "escrow", "usage_proof", "sysvar_instructions", "system_program", "program_state"},
}

func TestCommittedIDLMatchesGoBuilders(t *testing.T) {
	idl := loadCommittedIDL(t)

	for name, wantAccounts := range goBuilderAccounts {
		ix, ok := idl[name]
		if !ok {
			t.Errorf("%s: sent by Go builders but missing from committed IDL", name)
			continue
		}

		wantDisc := anchorDiscriminator(name)
		if len(ix.Discriminator) != 8 {
			t.Errorf("%s: IDL discriminator has %d bytes, want 8", name, len(ix.Discriminator))
			continue
		}
		for i := 0; i < 8; i++ {
			if ix.Discriminator[i] != wantDisc[i] {
				t.Errorf("%s: discriminator mismatch: IDL %v, Go computes %v", name, ix.Discriminator, wantDisc)
				break
			}
		}

		got := make([]string, len(ix.Accounts))
		for i, a := range ix.Accounts {
			got[i] = a.Name
		}
		if len(got) != len(wantAccounts) {
			t.Errorf("%s: IDL accounts %v, Go builder passes %v", name, got, wantAccounts)
			continue
		}
		for i := range wantAccounts {
			if got[i] != wantAccounts[i] {
				t.Errorf("%s: account %d: IDL %q, Go builder passes %q (IDL %v vs Go %v)", name, i, got[i], wantAccounts[i], got, wantAccounts)
				break
			}
		}
	}
}

// adminBoundSigners records which hardened instructions bind their signer to
// program_state.admin on chain. The IDL cannot express the address
// constraint, so this test only asserts the signer position the Go builders
// rely on: the first account is the oracle signer slot that control-api
// signs with its oracle/admin key. settle_session_escrow's oracle is
// read-only (it pays no rent); the rest pay rent and are writable.
// settle_escrow is covered above (authority signer, read-only).
func TestCommittedIDLAdminSignerSlots(t *testing.T) {
	idl := loadCommittedIDL(t)

	wantWritable := map[string]bool{
		"stake_provider": true, "unstake_provider": true,
		"lock_session_commitment": true, "create_proposal": true,
		"open_dispute_onchain": true, "submit_review_attestation": true,
		"settle_session_escrow": false, "submit_usage_proof": true,
	}
	for name, writable := range wantWritable {
		ix, ok := idl[name]
		if !ok || len(ix.Accounts) == 0 {
			t.Errorf("%s: missing from IDL or has no accounts", name)
			continue
		}
		first := ix.Accounts[0]
		if first.Name != "oracle" || !first.Signer || first.Writable != writable {
			t.Errorf("%s: first IDL account = %+v, want oracle signer with writable=%v", name, first, writable)
		}
		last := ix.Accounts[len(ix.Accounts)-1]
		if name != "unstake_provider" && last.Name != "program_state" {
			t.Errorf("%s: last IDL account = %q, want program_state present for the admin binding", name, last.Name)
		}
	}
}
