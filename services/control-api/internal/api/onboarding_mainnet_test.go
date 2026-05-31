package api

import (
	"testing"

	"github.com/proxyhubb/control-api/internal/models"
)

func TestMainnetProviderAutoApproval_KYCRequired(t *testing.T) {
	wallet := "9MpMTRvPxG1o2Jg6pR4Xy1Vh3sQzC6LzD6oJmNw5z7nA"
	user := &models.User{
		Status:        models.UserStatusActive,
		WalletAddress: &wallet,
		KYCStatus:     models.KYCStatusPending,
	}

	result := mainnetProviderAutoApproval(user, "mainnet-beta", ProviderAutoApprovalResult{SolanaNetwork: "mainnet-beta"})
	if result.Status != "pending" {
		t.Fatalf("expected pending, got %s", result.Status)
	}
	if result.ReasonCode != "kyc_required" {
		t.Fatalf("expected kyc_required, got %s", result.ReasonCode)
	}
	if result.AutoApproved {
		t.Fatal("balance-only auto-approve must not apply on mainnet")
	}
}

func TestMainnetProviderAutoApproval_ApprovedWithKYC(t *testing.T) {
	wallet := "9MpMTRvPxG1o2Jg6pR4Xy1Vh3sQzC6LzD6oJmNw5z7nA"
	user := &models.User{
		Status:        models.UserStatusActive,
		WalletAddress: &wallet,
		KYCStatus:     models.KYCStatusApproved,
	}

	result := mainnetProviderAutoApproval(user, "mainnet-beta", ProviderAutoApprovalResult{SolanaNetwork: "mainnet-beta"})
	if result.Status != "approved" || !result.AutoApproved {
		t.Fatalf("expected approved auto-approval, got status=%s auto=%v", result.Status, result.AutoApproved)
	}
	if result.ReasonCode != "kyc_verified" {
		t.Fatalf("expected kyc_verified, got %s", result.ReasonCode)
	}
}
