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
