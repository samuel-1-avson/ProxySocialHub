package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func TestNormalizeListingProtocols(t *testing.T) {
	cases := map[string]string{
		"http":              "http",
		"HTTP":              "http",
		"socks5,http":       "http,socks5",
		" https ; HTTP ":    "http,https",
		"socks5,https,http": "http,https,socks5",
		"http,http,socks5 ": "http,socks5",
	}
	for in, want := range cases {
		got, problem := normalizeListingProtocols(in)
		if problem != "" || got != want {
			t.Errorf("normalizeListingProtocols(%q) = %q, %q; want %q", in, got, problem, want)
		}
	}
	for _, bad := range []string{"", " , ", "ftp", "http,ssh"} {
		if got, problem := normalizeListingProtocols(bad); problem == "" {
			t.Errorf("normalizeListingProtocols(%q) = %q; want a problem", bad, got)
		}
	}
}

func postListing(t *testing.T, userID string, body any) *httptest.ResponseRecorder {
	t.Helper()
	r := setupTestRouter()
	r.Use(func(c *gin.Context) { c.Set("user_id", userID) })
	r.POST("/listings", createListing)
	raw, _ := json.Marshal(body)
	req := httptest.NewRequest("POST", "/listings", bytes.NewBuffer(raw))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestCreateListing_PlainValidationMessages(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "proxy_listings")
	provider := testutil.CreateTestUser(t, testutil.UniqueEmail("provider_msgs"), "provider")

	base := map[string]any{
		"title": "Accra residential", "proxy_type": "residential", "protocol": "http",
		"price_per_gb": 1.5, "available_bandwidth_gb": 10, "max_concurrency": 10,
	}
	cases := []struct {
		name   string
		change map[string]any
		want   string
	}{
		{"short title", map[string]any{"title": "Abc"}, "Offer title must be at least 5 characters."},
		{"long isp", map[string]any{"isp": strings.Repeat("x", 101)}, "Internet provider can be at most 100 characters."},
		{"too many connections", map[string]any{"max_concurrency": 101}, "Concurrent connections can be at most 100."},
		{"unknown protocol", map[string]any{"protocol": "http,ftp"}, `Unknown protocol "ftp". Choose from HTTP, HTTPS and SOCKS5.`},
	}
	for _, tc := range cases {
		body := map[string]any{}
		for k, v := range base {
			body[k] = v
		}
		for k, v := range tc.change {
			body[k] = v
		}
		w := postListing(t, provider.ID.String(), body)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("%s: want 400, got %d: %s", tc.name, w.Code, w.Body.String())
		}
		var resp map[string]any
		_ = json.Unmarshal(w.Body.Bytes(), &resp)
		if resp["error"] != tc.want {
			t.Errorf("%s: error = %q, want %q", tc.name, resp["error"], tc.want)
		}
	}
}

func TestCreateListing_SeveralProtocolsAndFilter(t *testing.T) {
	t.Setenv("LISTING_QUALITY_MODE", "observe") // Legacy workflow; assessment enforcement has dedicated tests.
	testutil.SetupTestDB(t)
	testutil.SetupTestRedis(t)
	testutil.CleanupTestData(t, "users", "proxy_listings")
	provider := testutil.CreateTestUser(t, testutil.UniqueEmail("provider_protocols"), "provider")

	w := postListing(t, provider.ID.String(), map[string]any{
		"title": "Mixed protocols", "proxy_type": "residential", "protocol": "socks5,HTTP",
		"price_per_gb": 2, "available_bandwidth_gb": 10, "max_concurrency": 10,
	})
	if w.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d: %s", w.Code, w.Body.String())
	}
	var created models.ProxyListing
	_ = json.Unmarshal(w.Body.Bytes(), &created)
	if created.Protocol != "http,socks5" {
		t.Fatalf("stored protocol = %q, want canonical %q", created.Protocol, "http,socks5")
	}
	db.DB.Create(&models.ProxyListing{
		SellerID: provider.ID, Title: "HTTPS only", ProxyType: "datacenter",
		Protocol: "https", PricePerGB: 1, Status: models.ListingStatusActive,
	})

	r := setupTestRouter()
	r.GET("/listings", getListings)
	titles := func(protocol string) []string {
		req := httptest.NewRequest("GET", "/listings?protocol="+protocol+"&seller_id="+provider.ID.String(), nil)
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		var resp ListingsResponse
		_ = json.Unmarshal(rec.Body.Bytes(), &resp)
		out := []string{}
		for _, l := range resp.Listings {
			out = append(out, l.Title)
		}
		return out
	}
	if got := titles("socks5"); len(got) != 1 || got[0] != "Mixed protocols" {
		t.Errorf("protocol=socks5 matched %v, want [Mixed protocols]", got)
	}
	if got := titles("http"); len(got) != 1 || got[0] != "Mixed protocols" {
		t.Errorf("protocol=http matched %v; http must not match https", got)
	}
	if got := titles("https"); len(got) != 1 || got[0] != "HTTPS only" {
		t.Errorf("protocol=https matched %v, want [HTTPS only]", got)
	}
}
