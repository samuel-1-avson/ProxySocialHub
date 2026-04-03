package api

import (
	"crypto/ed25519"
	"encoding/base64"
	"testing"
	"time"
)

func TestVerifyWriterIdentityEvidence_ValidAndInvalidSignature(t *testing.T) {
	seed := []byte("0123456789abcdef0123456789abcdef")
	priv := ed25519.NewKeyFromSeed(seed)
	pub := priv.Public().(ed25519.PublicKey)

	attestedAt := time.Unix(1_710_000_000, 123_000_000).UTC()
	evidence := explorerWriterIdentityEvidence{
		WriterID:        "writer-alpha",
		Chain:           "solana",
		Slot:            999,
		BlockHash:       "blockhash-123",
		ParentHash:      "parenthash-122",
		AttestedAt:      attestedAt,
		WriterPublicKey: base64.StdEncoding.EncodeToString(pub),
		SignatureScheme: "ed25519",
	}

	payload := []byte("solana|999|blockhash-123|parenthash-122|1710000000123000000|writer-alpha")
	evidence.AttestationSignature = base64.StdEncoding.EncodeToString(ed25519.Sign(priv, payload))

	if !verifyWriterIdentityEvidence(evidence) {
		t.Fatal("expected valid writer identity evidence to verify")
	}

	evidence.AttestationSignature = base64.StdEncoding.EncodeToString(ed25519.Sign(priv, []byte("tampered")))
	if verifyWriterIdentityEvidence(evidence) {
		t.Fatal("expected tampered signature evidence to fail verification")
	}
}

func TestBuildWriterHealthRows_ComputesLagAndConflictFields(t *testing.T) {
	response := ExplorerDecentralizationWritersResponse{RecentSlotsAnalyzed: 100}
	latestSlot := uint64(1000)
	rows := []explorerWriterRollupRow{
		{
			WriterID:         "writer-1",
			RPCEndpoint:      "https://rpc1",
			LatestSlot:       1000,
			AttestationCount: 100,
			SlotsCovered:     100,
			FirstAttestedAt:  time.Now().Add(-10 * time.Minute),
			LastAttestedAt:   time.Now(),
		},
		{
			WriterID:         "writer-2",
			RPCEndpoint:      "https://rpc2",
			LatestSlot:       995,
			AttestationCount: 70,
			SlotsCovered:     70,
			FirstAttestedAt:  time.Now().Add(-20 * time.Minute),
			LastAttestedAt:   time.Now().Add(-30 * time.Second),
		},
	}

	conflicts := map[string]int64{"writer-2": 4}
	identity := map[string]explorerWriterIdentityEvidence{}

	health := buildWriterHealthRows(response, latestSlot, rows, conflicts, identity)
	if len(health) != 2 {
		t.Fatalf("expected 2 writer health rows, got %d", len(health))
	}

	if health[0].LagSlots != 0 {
		t.Fatalf("expected writer-1 lag 0, got %d", health[0].LagSlots)
	}
	if health[1].LagSlots != 5 {
		t.Fatalf("expected writer-2 lag 5, got %d", health[1].LagSlots)
	}
	if health[1].ConflictingSlots != 4 {
		t.Fatalf("expected writer-2 conflicts 4, got %d", health[1].ConflictingSlots)
	}
	if health[1].ParticipationRatio != 0.7 {
		t.Fatalf("expected writer-2 participation 0.7, got %.6f", health[1].ParticipationRatio)
	}
}
