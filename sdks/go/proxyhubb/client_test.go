package proxyhubb_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/samuel-1-avson/ProxySocialHub/sdks/go/proxyhubb"
)

func TestNewClientDefaults(t *testing.T) {
	c := proxyhubb.NewClient("phub_test")
	if c.APIKey != "phub_test" {
		t.Fatalf("api key: got %q", c.APIKey)
	}
	if c.BaseURL != proxyhubb.DefaultBaseURL {
		t.Fatalf("base url: got %q", c.BaseURL)
	}
	if c.ProxyEndpoint != proxyhubb.DefaultProxyEndpoint {
		t.Fatalf("proxy endpoint: got %q", c.ProxyEndpoint)
	}
}

func TestProxyURLHelpers(t *testing.T) {
	got := proxyhubb.ProxyURL("u", "p", "proxy.proxyhubb.com:8090")
	want := "http://u:p@proxy.proxyhubb.com:8090"
	if got != want {
		t.Fatalf("ProxyURL: got %q want %q", got, want)
	}
	got = proxyhubb.SessionIntentProxyURL("tok", "")
	if got != "http://session-intent:tok@proxy.proxyhubb.com:8090" {
		t.Fatalf("SessionIntentProxyURL: got %q", got)
	}
}

func TestCreateSessionIntent(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/sessions/intent" || r.Method != http.MethodPost {
			t.Fatalf("unexpected %s %s", r.Method, r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer jwt" {
			t.Fatalf("auth: %q", got)
		}
		var body map[string]interface{}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["type"] != "sticky" {
			t.Fatalf("type: %#v", body["type"])
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"token":           "abc",
			"lifecycle_state": "authorized",
			"intent":          map[string]interface{}{"session_type": "sticky"},
		})
	}))
	defer srv.Close()

	c := proxyhubb.NewClientWithToken("jwt")
	c.BaseURL = srv.URL
	out, err := c.CreateSessionIntent(context.Background(), proxyhubb.CreateSessionIntentRequest{
		Type:      "sticky",
		TargetGeo: "US",
	})
	if err != nil {
		t.Fatal(err)
	}
	if out.Token != "abc" {
		t.Fatalf("token: %q", out.Token)
	}
}

func TestGetOrderCredentials(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/orders/ord-1/credentials" {
			t.Fatalf("path: %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"proxy_credentials": map[string]interface{}{
				"username": "u",
				"password": "p",
				"host":     "proxy.proxyhubb.com",
				"port":     8090,
			},
		})
	}))
	defer srv.Close()

	c := proxyhubb.NewClientWithToken("jwt")
	c.BaseURL = srv.URL
	creds, err := c.GetOrderCredentials(context.Background(), "ord-1")
	if err != nil {
		t.Fatal(err)
	}
	url := c.ProxyURLFromCredentials(creds)
	if url != "http://u:p@proxy.proxyhubb.com:8090" {
		t.Fatalf("proxy url: %q", url)
	}
}

func TestCreateProviderToken(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/provider/tokens" || r.Method != http.MethodPost {
			t.Fatalf("unexpected %s %s", r.Method, r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer ptok" {
			t.Fatalf("auth: %q", got)
		}
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"id":    "t1",
			"token": "raw-once",
		})
	}))
	defer srv.Close()

	c := proxyhubb.NewClientWithProviderToken("ptok")
	c.BaseURL = srv.URL
	out, err := c.CreateProviderToken(context.Background(), proxyhubb.CreateProviderTokenRequest{
		Name:   "edge",
		NodeID: "n1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if out["token"] != "raw-once" {
		t.Fatalf("token: %#v", out["token"])
	}
}

func TestSellerListingAndEarnings(t *testing.T) {
	var seen []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.Method+" "+r.URL.RequestURI())
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})
	}))
	defer srv.Close()

	c := proxyhubb.NewClientWithToken("jwt")
	c.BaseURL = srv.URL
	if _, err := c.GetNodeConnect(context.Background(), "n1"); err != nil {
		t.Fatal(err)
	}
	if _, err := c.GetEarningsSummary(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := c.ListMyListings(context.Background(), 1, 10); err != nil {
		t.Fatal(err)
	}
	if _, err := c.UpdateListing(context.Background(), "l1", map[string]interface{}{"status": "paused"}); err != nil {
		t.Fatal(err)
	}
	want := []string{
		"GET /v1/provider/nodes/n1/connect",
		"GET /v1/provider/earnings/summary",
		"GET /v1/listings/my?limit=10&page=1",
		"PATCH /v1/listings/l1",
	}
	if len(seen) != len(want) {
		t.Fatalf("seen=%v", seen)
	}
	for i := range want {
		if seen[i] != want[i] {
			t.Fatalf("seen[%d]=%q want %q", i, seen[i], want[i])
		}
	}
}

func TestDePINMethods(t *testing.T) {
	var seen []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.Method+" "+r.URL.RequestURI())
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})
	}))
	defer srv.Close()

	c := proxyhubb.NewClientWithToken("jwt")
	c.BaseURL = srv.URL

	_, err := c.CreateP2PSignalOffer(context.Background(), proxyhubb.P2PSignalOfferRequest{
		SessionID:      "sess-123",
		BuyerPubkey:    "buyer-pk",
		ProviderHotkey: "provider-hk",
		OfferSDP:       "v=0...",
		ICECandidates:  []string{"candidate:1..."},
	})
	if err != nil {
		t.Fatal(err)
	}

	_, err = c.CreateP2PSignalAnswer(context.Background(), proxyhubb.P2PSignalAnswerRequest{
		SessionID:      "sess-123",
		ProviderHotkey: "provider-hk",
		AnswerSDP:      "v=0...",
	})
	if err != nil {
		t.Fatal(err)
	}

	if _, err := c.GetP2PSignals(context.Background(), "sess-123"); err != nil {
		t.Fatal(err)
	}
	if _, err := c.GetGatewayOperators(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := c.GetDePINMiningStats(context.Background()); err != nil {
		t.Fatal(err)
	}

	want := []string{
		"POST /v1/p2p/signal/offer",
		"POST /v1/p2p/signal/answer",
		"GET /v1/p2p/signal/sess-123",
		"GET /v1/gateways/operators",
		"GET /v1/network",
	}
	if len(seen) != len(want) {
		t.Fatalf("seen=%v want=%v", seen, want)
	}
	for i := range want {
		if seen[i] != want[i] {
			t.Fatalf("seen[%d]=%q want %q", i, seen[i], want[i])
		}
	}
}
