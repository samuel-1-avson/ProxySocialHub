package solana

import "testing"

func TestNormalizeRPCEndpoint(t *testing.T) {
	cases := map[string]string{
		"api.devnet.solana.com":         "https://api.devnet.solana.com",
		"https://api.devnet.solana.com": "https://api.devnet.solana.com",
		"wss://api.devnet.solana.com":   "https://api.devnet.solana.com",
		"http://127.0.0.1:8899":         "http://127.0.0.1:8899",
	}
	for input, want := range cases {
		got, err := NormalizeRPCEndpoint(input)
		if err != nil {
			t.Fatalf("NormalizeRPCEndpoint(%q) returned error: %v", input, err)
		}
		if got != want {
			t.Fatalf("NormalizeRPCEndpoint(%q)=%q want %q", input, got, want)
		}
	}
}

func TestNormalizeRPCEndpointsDedupesAndDropsInvalid(t *testing.T) {
	got := NormalizeRPCEndpoints([]string{
		"https://api.devnet.solana.com",
		"wss://api.devnet.solana.com",
		"ftp://bad.example",
		"",
	})
	if len(got) != 1 || got[0] != "https://api.devnet.solana.com" {
		t.Fatalf("got %#v, want single normalized devnet endpoint", got)
	}
}

func TestDeriveWSEndpoint(t *testing.T) {
	got, err := DeriveWSEndpoint("https://api.devnet.solana.com")
	if err != nil {
		t.Fatalf("DeriveWSEndpoint returned error: %v", err)
	}
	if got != "wss://api.devnet.solana.com" {
		t.Fatalf("got %q, want wss://api.devnet.solana.com", got)
	}
}
