package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func TestGetKYCStatus(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "kyc_verifications")

	email := testutil.UniqueEmail("kyc_status")
	user := testutil.CreateTestUser(t, email, "buyer")

	r := setupTestRouter()
	r.Use(authMiddlewareMock(user.ID.String(), "buyer"))
	r.GET("/kyc/status", getKycStatus)

	req := httptest.NewRequest("GET", "/kyc/status", nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status %d, got %d. Body: %s", http.StatusOK, w.Code, w.Body.String())
	}

	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)

	// Check that we got a status response (could be not_started for new users)
	if response["status"] == nil {
		t.Error("Expected status in response")
	}
}

func TestKYCModelValidation(t *testing.T) {
	tests := []struct {
		status   models.KYCStatus
		verified bool
		pending  bool
	}{
		{models.KYCStatusNotStarted, false, false},
		{models.KYCStatusPending, false, true},
		{models.KYCStatusInReview, false, true},
		{models.KYCStatusApproved, true, false},
		{models.KYCStatusRejected, false, false},
	}

	for _, tt := range tests {
		kyc := models.KycVerification{Status: tt.status}

		if kyc.IsVerified() != tt.verified {
			t.Errorf("KYC status %s: expected IsVerified=%v, got %v", tt.status, tt.verified, kyc.IsVerified())
		}
		if kyc.IsPending() != tt.pending {
			t.Errorf("KYC status %s: expected IsPending=%v, got %v", tt.status, tt.pending, kyc.IsPending())
		}
	}
}

func TestKYCDocumentTypes(t *testing.T) {
	validTypes := []models.DocumentType{
		models.DocumentPassport,
		models.DocumentIDCard,
		models.DocumentDriverLicense,
		models.DocumentVoterID,
		models.DocumentGhanaCard,
	}

	for _, docType := range validTypes {
		if docType == "" {
			t.Error("Document type should not be empty")
		}
	}
}
