package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestGetListingProofPolicy_ObserveDefault(t *testing.T) {
	t.Setenv("PROVIDER_SIGNATURE_MODE", "")
	t.Setenv("APP_ENV", "development")
	r := gin.New()
	r.GET("/listings/proof-policy", getListingProofPolicy)

	req := httptest.NewRequest(http.MethodGet, "/listings/proof-policy", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status %d body %s", w.Code, w.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["mode"] != "observe" || body["required"] != false {
		t.Fatalf("unexpected policy: %+v", body)
	}
	if _, ok := body["dev_server_signing"]; !ok {
		t.Fatalf("expected dev_server_signing field: %+v", body)
	}
}

func TestGetListingProofPolicy_Enforce(t *testing.T) {
	t.Setenv("PROVIDER_SIGNATURE_MODE", "enforce")
	r := gin.New()
	r.GET("/listings/proof-policy", getListingProofPolicy)

	req := httptest.NewRequest(http.MethodGet, "/listings/proof-policy", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["mode"] != "enforce" || body["required"] != true {
		t.Fatalf("unexpected policy: %+v", body)
	}
}

func TestGetListingProofPolicy_ProductionDefaultEnforce(t *testing.T) {
	t.Setenv("PROVIDER_SIGNATURE_MODE", "")
	t.Setenv("APP_ENV", "production")
	r := gin.New()
	r.GET("/listings/proof-policy", getListingProofPolicy)

	req := httptest.NewRequest(http.MethodGet, "/listings/proof-policy", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["mode"] != "enforce" || body["required"] != true {
		t.Fatalf("unexpected policy: %+v", body)
	}
}
