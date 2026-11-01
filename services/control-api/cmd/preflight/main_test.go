package main

import (
	"encoding/binary"
	"testing"

	sol "github.com/gagliardetto/solana-go"
)

func TestParseProgramAccount(t *testing.T) {
	want, err := sol.PublicKeyFromBase58("AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu")
	if err != nil {
		t.Fatal(err)
	}
	data := make([]byte, 36)
	binary.LittleEndian.PutUint32(data[0:4], 2)
	copy(data[4:36], want.Bytes())

	got, err := parseProgramAccount(data)
	if err != nil {
		t.Fatalf("valid Program account: %v", err)
	}
	if !got.Equals(want) {
		t.Fatalf("got %s, want %s", got, want)
	}

	if _, err := parseProgramAccount(data[:35]); err == nil {
		t.Fatal("short data must fail")
	}
	binary.LittleEndian.PutUint32(data[0:4], 1)
	if _, err := parseProgramAccount(data); err == nil {
		t.Fatal("Buffer discriminant must fail")
	}
}

func TestParseProgramDataAuthority(t *testing.T) {
	authority, err := sol.PublicKeyFromBase58("8P4w8qk1R2y9m4nZ7xQ3vT6sE5dC1bA9zX0yW8vU7tS6")
	if err != nil {
		// Fallback: any fixed 32 bytes work for layout purposes.
		authority = sol.PublicKey{1, 2, 3}
	}

	some := make([]byte, 48)
	binary.LittleEndian.PutUint32(some[0:4], 3)
	binary.LittleEndian.PutUint64(some[4:12], 12345)
	binary.LittleEndian.PutUint32(some[12:16], 1)
	copy(some[16:48], authority.Bytes())

	present, got, err := parseProgramDataAuthority(some)
	if err != nil {
		t.Fatalf("valid ProgramData: %v", err)
	}
	if !present {
		t.Fatal("expected authority present")
	}
	if !got.Equals(authority) {
		t.Fatalf("got %s, want %s", got, authority)
	}

	none := make([]byte, 16)
	binary.LittleEndian.PutUint32(none[0:4], 3)
	binary.LittleEndian.PutUint32(none[12:16], 0)
	present, _, err = parseProgramDataAuthority(none)
	if err != nil {
		t.Fatalf("None authority: %v", err)
	}
	if present {
		t.Fatal("expected authority absent")
	}

	if _, _, err := parseProgramDataAuthority(some[:15]); err == nil {
		t.Fatal("short data must fail")
	}
	bad := make([]byte, 48)
	binary.LittleEndian.PutUint32(bad[0:4], 2)
	if _, _, err := parseProgramDataAuthority(bad); err == nil {
		t.Fatal("wrong discriminant must fail")
	}
	tagged := make([]byte, 48)
	binary.LittleEndian.PutUint32(tagged[0:4], 3)
	binary.LittleEndian.PutUint32(tagged[12:16], 7)
	if _, _, err := parseProgramDataAuthority(tagged); err == nil {
		t.Fatal("bad option tag must fail")
	}
}

func TestBannerConsistent(t *testing.T) {
	cases := []struct {
		name    string
		appEnv  string
		network string
		show    string
		want    status
	}{
		{"prod hidden mainnet", "production", "mainnet-beta", "0", statusPass},
		{"prod visible fails", "production", "mainnet-beta", "", statusFail},
		{"prod wrong network fails", "production", "devnet", "0", statusFail},
		{"prod alias", "prod", "mainnet", "false", statusPass},
		{"testnet default visible", "testnet", "devnet", "", statusPass},
		{"testnet forced visible", "testnet", "mainnet-beta", "1", statusPass},
		{"testnet hidden fails", "testnet", "devnet", "0", statusFail},
		{"staging visible", "staging", "devnet", "", statusPass},
		{"staging hidden fails", "staging", "devnet", "no", statusFail},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, reason := bannerConsistent(tc.appEnv, tc.network, tc.show)
			if got != tc.want {
				t.Fatalf("got %s (%s), want %s", got, reason, tc.want)
			}
		})
	}
}

func TestBannerVisible(t *testing.T) {
	if !bannerVisible("devnet", "") {
		t.Fatal("devnet default must show")
	}
	if bannerVisible("devnet", "0") {
		t.Fatal("force-off must hide")
	}
	if !bannerVisible("mainnet-beta", "1") {
		t.Fatal("force-on must show")
	}
	if bannerVisible("mainnet-beta", "") {
		t.Fatal("mainnet default must hide")
	}
}

func TestIsPublicEndpoint(t *testing.T) {
	if !isPublicEndpoint("https://api.devnet.solana.com") {
		t.Fatal("devnet public must match")
	}
	if !isPublicEndpoint("https://api.mainnet-beta.solana.com") {
		t.Fatal("mainnet public must match")
	}
	if isPublicEndpoint("https://solana-mainnet.g.alchemy.com/v2/abc") {
		t.Fatal("private vendor must not match")
	}
}

func TestIsTruthy(t *testing.T) {
	for _, v := range []string{"1", "true", "TRUE", "yes", "on", " y "} {
		if !isTruthy(v) {
			t.Fatalf("%q must be truthy", v)
		}
	}
	for _, v := range []string{"", "0", "false", "no", "off"} {
		if isTruthy(v) {
			t.Fatalf("%q must be falsy", v)
		}
	}
}

func TestLamportsToSOL(t *testing.T) {
	if got := lamportsToSOL(1_500_000_000); got != 1.5 {
		t.Fatalf("got %v", got)
	}
}

func TestShortKey(t *testing.T) {
	if got := shortKey("ABCDEFGH12345678"); got != "ABCDEFGH…5678" {
		t.Fatalf("got %q", got)
	}
	if got := shortKey("short"); got != "short" {
		t.Fatalf("got %q", got)
	}
}
