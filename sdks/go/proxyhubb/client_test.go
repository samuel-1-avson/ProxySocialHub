package proxyhubb_test

import (
	"testing"

	"github.com/samuel-1-avson/ProxySocialHub/sdks/go/proxyhubb"
)

func TestNewClientDefaults(t *testing.T) {
	c := proxyhubb.NewClient("phub_test")
	if c.APIKey != "phub_test" {
		t.Fatalf("api key: got %q", c.APIKey)
	}
	if c.BaseURL != "https://api.proxyhubb.com" {
		t.Fatalf("base url: got %q", c.BaseURL)
	}
}
