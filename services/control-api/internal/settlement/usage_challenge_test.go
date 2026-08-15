package settlement

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
	"testing"
)

func TestUsageChallengeEvidenceHash_canonical(t *testing.T) {
	leaves := bytes32(0xab)
	sig := "SigBase58Example"
	got, err := UsageChallengeEvidenceHash("w9d-window-1", hex.EncodeToString(leaves[:]), sig)
	if err != nil {
		t.Fatal(err)
	}
	msg := "PROXYHUB_USAGE_CHALLENGE:v1:w9d-window-1|" + hex.EncodeToString(leaves[:]) + "|" + sig
	want := sha256.Sum256([]byte(msg))
	if got != want {
		t.Fatalf("hash\n got %x\nwant %x", got, want)
	}
	upper, err := UsageChallengeEvidenceHash("w9d-window-1", "0x"+strings.ToUpper(hex.EncodeToString(leaves[:])), sig)
	if err != nil || upper != got {
		t.Fatalf("hex normalize: %v %x", err, upper)
	}
}

func TestUsageChallengeEvidenceHash_rejectsBadLeaves(t *testing.T) {
	if _, err := UsageChallengeEvidenceHash("", bytes32hex(0xab), "sig"); err == nil {
		t.Fatal("empty window")
	}
	if _, err := UsageChallengeEvidenceHash("w1", strings.Repeat("00", 32), "sig"); err == nil {
		t.Fatal("zero leaves")
	}
	if _, err := UsageChallengeEvidenceHash("w1", "aa", "sig"); err == nil {
		t.Fatal("short leaves")
	}
}

func TestUsageChallengeBuildAndVerifyPetition(t *testing.T) {
	r, err := EmitSampleReceipt(testSecret(t), "")
	if err != nil {
		t.Fatal(err)
	}
	p, err := BuildPetition(r, bytes32hex(0xcd))
	if err != nil {
		t.Fatal(err)
	}
	if p.MessageType != UsageChallengeMessageType || p.ResolvePath != "release" {
		t.Fatalf("petition meta: %+v", p)
	}
	if p.WindowKey != r.WindowKey || p.ReceiptSignature != r.Signature {
		t.Fatal("binding")
	}
	if err := VerifyPetition(p); err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(p)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := ParsePetition(raw)
	if err != nil {
		t.Fatal(err)
	}
	if err := VerifyPetition(*parsed); err != nil {
		t.Fatal(err)
	}
	sum, err := EvidenceHashBytes(*parsed)
	if err != nil {
		t.Fatal(err)
	}
	if hex.EncodeToString(sum[:]) != p.EvidenceHash {
		t.Fatal("evidence bytes")
	}
}

func TestUsageChallengeVerifyPetition_rejectsTamperAndSlashPath(t *testing.T) {
	r, err := EmitSampleReceipt(testSecret(t), "")
	if err != nil {
		t.Fatal(err)
	}
	p, err := BuildPetition(r, bytes32hex(0x11))
	if err != nil {
		t.Fatal(err)
	}
	bad := p
	bad.EvidenceHash = strings.Repeat("ab", 32)
	if err := VerifyPetition(bad); err == nil {
		t.Fatal("tampered hash")
	}
	slash := p
	slash.ResolvePath = "slash"
	if err := VerifyPetition(slash); err == nil {
		t.Fatal("slash path")
	}
	unsigned := r
	unsigned.Signature = "nope"
	if _, err := BuildPetition(unsigned, bytes32hex(0x11)); err == nil {
		t.Fatal("unsigned receipt")
	}
}

func TestUsageChallengeParsePetitionRejectsWrongType(t *testing.T) {
	if _, err := ParsePetition([]byte(`{"message_type":"NOPE"}`)); err == nil {
		t.Fatal("wrong type")
	}
}

func bytes32(b byte) [32]byte {
	var out [32]byte
	for i := range out {
		out[i] = b
	}
	return out
}

func bytes32hex(b byte) string {
	v := bytes32(b)
	return hex.EncodeToString(v[:])
}
