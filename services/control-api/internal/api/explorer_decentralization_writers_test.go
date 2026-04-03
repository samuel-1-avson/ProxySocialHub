package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestGetExplorerDecentralizationWriters_LagAndConflictEdgeCases(t *testing.T) {
	origLoader := explorerDecentralizationWritersLoader
	t.Cleanup(func() {
		explorerDecentralizationWritersLoader = origLoader
	})

	now := time.Now().UTC().Truncate(time.Second)
	explorerDecentralizationWritersLoader = func(windowSlots uint64) (ExplorerDecentralizationWritersResponse, error) {
		return ExplorerDecentralizationWritersResponse{
			Chain:               "solana",
			WindowSlots:         windowSlots,
			LatestAttestedSlot:  512,
			RecentSlotsAnalyzed: 256,
			MinWritersRequired:  3,
			Writers: []ExplorerWriterHealth{
				{
					WriterID:                "writer-fast",
					RPCEndpoint:             "https://rpc.fast.example",
					WriterPublicKey:         "pub-fast",
					SignatureScheme:         "ed25519",
					HasAttestationSignature: true,
					IdentityVerified:        true,
					LatestSlot:              512,
					LagSlots:                0,
					AttestationCount:        256,
					SlotsCovered:            256,
					ParticipationRatio:      1.0,
					ConflictingSlots:        0,
					FirstAttestedAt:         now.Add(-5 * time.Minute),
					LastAttestedAt:          now,
				},
				{
					WriterID:                "writer-lagging",
					RPCEndpoint:             "https://rpc.slow.example",
					WriterPublicKey:         "pub-slow",
					SignatureScheme:         "",
					HasAttestationSignature: false,
					IdentityVerified:        false,
					LatestSlot:              505,
					LagSlots:                7,
					AttestationCount:        180,
					SlotsCovered:            180,
					ParticipationRatio:      180.0 / 256.0,
					ConflictingSlots:        3,
					FirstAttestedAt:         now.Add(-7 * time.Minute),
					LastAttestedAt:          now.Add(-20 * time.Second),
				},
			},
			LastUpdated: now,
		}, nil
	}

	r := setupTestRouter()
	RegisterExplorerRoutes(r.Group("/v1"))

	req := httptest.NewRequest(http.MethodGet, "/v1/explorer/decentralization/writers?window_slots=256", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d, body=%s", http.StatusOK, w.Code, w.Body.String())
	}

	assertAuthorityHeaders(t, w, authorityModeHybridAsyncChain, "indexed_reads_with_quorum_attestation", "mirror")

	var resp ExplorerDecentralizationWritersResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response JSON: %v", err)
	}
	if len(resp.Writers) != 2 {
		t.Fatalf("expected 2 writers, got %d", len(resp.Writers))
	}

	if resp.Writers[0].LagSlots != 0 || resp.Writers[0].ConflictingSlots != 0 {
		t.Fatalf("expected first writer to have lag=0 conflicts=0, got lag=%d conflicts=%d", resp.Writers[0].LagSlots, resp.Writers[0].ConflictingSlots)
	}
	if !resp.Writers[0].IdentityVerified {
		t.Fatal("expected first writer to be identity verified")
	}

	if resp.Writers[1].LagSlots == 0 {
		t.Fatal("expected second writer to have non-zero lag")
	}
	if resp.Writers[1].ConflictingSlots == 0 {
		t.Fatal("expected second writer to have non-zero conflicting slots")
	}
	if resp.Writers[1].IdentityVerified {
		t.Fatal("expected second writer to be unverified")
	}
}

func TestGetExplorerDecentralizationWriters_WindowSlotClamp(t *testing.T) {
	origLoader := explorerDecentralizationWritersLoader
	t.Cleanup(func() {
		explorerDecentralizationWritersLoader = origLoader
	})

	var capturedWindow uint64
	explorerDecentralizationWritersLoader = func(windowSlots uint64) (ExplorerDecentralizationWritersResponse, error) {
		capturedWindow = windowSlots
		return ExplorerDecentralizationWritersResponse{
			Chain:              "solana",
			WindowSlots:        windowSlots,
			MinWritersRequired: 2,
			Writers:            []ExplorerWriterHealth{},
			LastUpdated:        time.Now().UTC(),
		}, nil
	}

	r := setupTestRouter()
	RegisterExplorerRoutes(r.Group("/v1"))

	req := httptest.NewRequest(http.MethodGet, "/v1/explorer/decentralization/writers?window_slots=999999", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d, body=%s", http.StatusOK, w.Code, w.Body.String())
	}

	if capturedWindow != 4096 {
		t.Fatalf("expected clamped window 4096, got %d", capturedWindow)
	}
}
