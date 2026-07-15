package governance

import (
	"encoding/json"
	"testing"

	"github.com/proxyhubb/control-api/internal/models"
)

func TestBuildImpactPreview_GeneralSignal(t *testing.T) {
	preview, err := BuildImpactPreview(t.Context(), models.ProposalTypeGeneral, json.RawMessage(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	if preview.RiskLevel != "low" {
		t.Fatalf("expected low risk, got %s", preview.RiskLevel)
	}
	if preview.Summary == "" {
		t.Fatal("expected summary")
	}
}

func TestBuildImpactPreview_Treasury(t *testing.T) {
	raw := json.RawMessage(`{"recipient":"11111111111111111111111111111111","amount":5,"currency":"SOL","description":"grant"}`)
	preview, err := BuildImpactPreview(t.Context(), models.ProposalTypeTreasury, raw)
	if err != nil {
		t.Fatal(err)
	}
	if preview.RiskLevel == "" {
		t.Fatal("expected risk level")
	}
	if len(preview.Lines) < 2 {
		t.Fatalf("expected lines, got %d", len(preview.Lines))
	}
}
