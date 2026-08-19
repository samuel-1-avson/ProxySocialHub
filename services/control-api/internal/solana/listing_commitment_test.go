package solana

import (
	"context"
	"encoding/binary"
	"encoding/hex"
	"testing"

	sol "github.com/gagliardetto/solana-go"
	"github.com/google/uuid"
)

func TestParseOfferHashHex(t *testing.T) {
	var want [32]byte
	for i := 0; i < 32; i++ {
		want[i] = byte(i + 1)
	}
	hexStr := hex.EncodeToString(want[:])
	got, err := ParseOfferHashHex(hexStr)
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("mismatch")
	}
	if _, err := ParseOfferHashHex("abcd"); err == nil {
		t.Fatal("short hash must fail")
	}
}

func TestGetListingCommitmentPDADeterministic(t *testing.T) {
	c := &OracleClient{programID: sol.SystemProgramID}
	provider := sol.SystemProgramID
	var hash [32]byte
	hash[0] = 0xab
	a, bumpA, err := c.GetListingCommitmentPDA(provider, hash)
	if err != nil {
		t.Fatal(err)
	}
	b, bumpB, err := ListingCommitmentPDA(sol.SystemProgramID, provider, hash)
	if err != nil {
		t.Fatal(err)
	}
	if a != b || bumpA != bumpB {
		t.Fatal("PDA must be deterministic and match package helper")
	}
	hash[1] = 0xcd
	c2, _, err := c.GetListingCommitmentPDA(provider, hash)
	if err != nil {
		t.Fatal(err)
	}
	if c2 == a {
		t.Fatal("different offer hash must change PDA")
	}
	_ = uuid.Nil
}

func TestParseListingCommitmentAccount(t *testing.T) {
	disc := listingCommitmentAccountDisc()
	raw := make([]byte, ListingCommitmentAccountLen)
	copy(raw[:8], disc[:])
	copy(raw[8:40], sol.SystemProgramID.Bytes())
	raw[40] = 0xaa
	id := uuid.MustParse("12345678-1234-1234-1234-123456789abc")
	copy(raw[72:88], id[:])
	raw[88] = 1
	binary.LittleEndian.PutUint64(raw[89:97], 1_700_000_000)
	raw[97] = 7
	got, err := ParseListingCommitmentAccount(raw)
	if err != nil {
		t.Fatal(err)
	}
	if got.Provider != sol.SystemProgramID || got.OfferHash[0] != 0xaa || got.ListingID != id {
		t.Fatalf("parse mismatch: %+v", got)
	}
	if !got.IsActive || got.Bump != 7 || got.RegisteredAt != 1_700_000_000 {
		t.Fatalf("fields: %+v", got)
	}
}

func TestClassifyListingCommitmentLogs(t *testing.T) {
	if got := ClassifyListingCommitmentLogs(nil, "InstructionFallbackNotFound"); got != "ix_absent" {
		t.Fatalf("absent: %s", got)
	}
	if got := ClassifyListingCommitmentLogs([]string{"Instruction: RegisterListingCommitment"}, ""); got != "ix_present" {
		t.Fatalf("present: %s", got)
	}
	if got := ClassifyListingCommitmentLogs([]string{ListingCommitmentLogMarker}, ""); got != "ix_present" {
		t.Fatalf("marker: %s", got)
	}
	if got := ClassifyListingCommitmentLogs(nil, "boom"); got != "unknown" {
		t.Fatalf("unknown: %s", got)
	}
}

func TestBuildRegisterListingCommitmentRejectsSessionProgram(t *testing.T) {
	session, err := sol.PublicKeyFromBase58(UnsafeSessionProgramID)
	if err != nil {
		t.Fatal(err)
	}
	var hash [32]byte
	hash[0] = 1
	_, _, err = BuildRegisterListingCommitmentInstruction(session, sol.SystemProgramID, sol.SystemProgramID, hash, uuid.New())
	if err == nil {
		t.Fatal("session program must be rejected")
	}
}

func TestFetchListingCommitmentRejectsSession(t *testing.T) {
	var hash [32]byte
	hash[0] = 0xab
	_, err := FetchListingCommitment(context.Background(), "http://127.0.0.1:1", UnsafeSessionProgramID, sol.SystemProgramID, hash)
	if err == nil {
		t.Fatal("session program must be rejected")
	}
}

func TestRegisterListingCommitmentParamsRejectZeroHash(t *testing.T) {
	k, err := GenerateRandomKeypair()
	if err != nil {
		t.Fatal(err)
	}
	c := &OracleClient{programID: sol.SystemProgramID, hsm: NewMockHSMSigner(k)}
	_, err = c.RegisterListingCommitmentOnChain(context.Background(), RegisterListingCommitmentParams{
		Provider:  sol.SystemProgramID,
		OfferHash: [32]byte{},
		ListingID: uuid.New(),
	})
	if err == nil {
		t.Fatal("zero hash must fail before RPC")
	}
}

func TestRegisterListingCommitmentUsesHSMPubkeyWhenFileKeyEmpty(t *testing.T) {
	k, err := GenerateRandomKeypair()
	if err != nil {
		t.Fatal(err)
	}
	c := &OracleClient{
		programID: sol.SystemProgramID,
		hsm:       NewMockHSMSigner(k),
		// oracleKey left empty — gcp-testnet Cloud KMS path
	}
	var hash [32]byte
	hash[0] = 0xab
	id := uuid.MustParse("52b8b39b-15bd-454d-aa75-fb0f2a544aa6")
	provider := sol.MustPublicKeyFromBase58("9L4PsojpEY5sZvchMVcDtQTaSFS6teWhThuvKGJBX8Hp")
	ix, pda, err := BuildRegisterListingCommitmentInstruction(
		c.programID, c.GetOraclePublicKey(), provider, hash, id,
	)
	if err != nil {
		t.Fatal(err)
	}
	if pda == (sol.PublicKey{}) {
		t.Fatal("PDA must be derived")
	}
	accs := ix.Accounts()
	if len(accs) < 2 {
		t.Fatalf("accounts=%d", len(accs))
	}
	if !accs[1].PublicKey.Equals(k.PublicKey()) {
		t.Fatalf("oracle account=%s want HSM %s", accs[1].PublicKey, k.PublicKey())
	}
}

func TestRegisterListingCommitmentRejectsMissingSigner(t *testing.T) {
	c := &OracleClient{programID: sol.SystemProgramID}
	var hash [32]byte
	hash[0] = 0xab
	_, err := c.RegisterListingCommitmentOnChain(context.Background(), RegisterListingCommitmentParams{
		Provider:  sol.SystemProgramID,
		OfferHash: hash,
		ListingID: uuid.New(),
	})
	if err == nil {
		t.Fatal("missing KMS/file oracle must fail before RPC")
	}
}
