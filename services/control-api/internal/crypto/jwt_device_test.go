package crypto

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestGenerateDeviceToken_RoundTrip(t *testing.T) {
	secret := "test-jwt-secret-for-ci-min-32-chars-long"
	userID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	deviceID := "22222222-2222-2222-2222-222222222222"
	extID := "abcdefghijklmnopabcdefghijklmnop"
	tok, err := GenerateDeviceToken(userID, "buyer", "buyer@example.com", deviceID, extID, secret, time.Hour)
	if err != nil {
		t.Fatalf("GenerateDeviceToken: %v", err)
	}
	claims, err := ValidateToken(tok, secret)
	if err != nil {
		t.Fatalf("ValidateToken: %v", err)
	}
	if !claims.IsExtensionDevice() {
		t.Fatal("want extension device token")
	}
	if claims.UserID != userID.String() || claims.DeviceID != deviceID || claims.ExtID != extID {
		t.Fatalf("claims mismatch: %+v", claims)
	}
	web, err := GenerateToken(userID, "buyer", "buyer@example.com", "", secret, time.Hour)
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}
	webClaims, err := ValidateToken(web, secret)
	if err != nil {
		t.Fatalf("web ValidateToken: %v", err)
	}
	if webClaims.IsExtensionDevice() {
		t.Fatal("web JWT must not be an extension device token")
	}
}
