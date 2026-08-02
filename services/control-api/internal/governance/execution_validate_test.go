package governance

import (
	"encoding/json"
	"testing"

	"github.com/proxyhubb/control-api/internal/models"
)

func TestValidateExecutionPayload_SignalEmpty(t *testing.T) {
	if err := ValidateExecutionPayload(models.ProposalTypeGeneral, json.RawMessage(`{}`)); err != nil {
		t.Fatalf("expected nil, got %v", err)
	}
}

func TestValidateExecutionPayload_TreasuryRequiresSOL(t *testing.T) {
	raw := json.RawMessage(`{"recipient":"11111111111111111111111111111111","amount":1,"currency":"USDC","description":"test"}`)
	if err := ValidateExecutionPayload(models.ProposalTypeTreasury, raw); err == nil {
		t.Fatal("expected currency error")
	}
}

func TestValidateExecutionPayload_ParameterAllowed(t *testing.T) {
	raw := json.RawMessage(`{"parameter":"platform_fee","old_value":10,"new_value":8,"reason":"market alignment"}`)
	if err := ValidateExecutionPayload(models.ProposalTypeParameter, raw); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestValidateExecutionPayload_PassMintParameterAllowed(t *testing.T) {
	raw := json.RawMessage(`{"parameter":"pass_mint_silver","old_value":"","new_value":"SilverMint1111111111111111111111111111111","reason":"rotate silver pass mint"}`)
	if err := ValidateExecutionPayload(models.ProposalTypeParameter, raw); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}
