// Wallet security API smoke against a running control-api.
// Usage: go run ./cmd/smoke_wallet_api -base http://localhost:18080
package main

import (
	"bytes"
	"crypto/ed25519"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/mr-tron/base58"
)

func main() {
	base := flag.String("base", "http://localhost:18080", "control-api base URL")
	proxy := flag.String("proxy", "", "optional Next.js base (e.g. http://localhost:3000) to hit /v1 via rewrites")
	flag.Parse()

	pub, priv, _ := ed25519.GenerateKey(nil)
	addr := base58.Encode(pub)

	token := walletLogin(*base, addr, priv)
	fmt.Println("OK login, token length:", len(token))

	if *proxy != "" {
		resp, data := authReq(*proxy, token, "GET", "/v1/wallet/withdrawal-security", nil)
		check("A via Next proxy", resp.StatusCode, 200, data)
	}

	client := &http.Client{Timeout: 30 * time.Second}
	auth := func(method, path string, body any) (*http.Response, []byte) {
		return authReqClient(client, *base, token, method, path, body)
	}

	resp, data := auth("GET", "/v1/wallet/withdrawal-security", nil)
	check("A GET withdrawal-security", resp.StatusCode, 200, data)

	resp, data = auth("PUT", "/v1/wallet/withdrawal-security/whitelist", map[string]any{
		"addresses": []string{addr},
	})
	check("F PUT whitelist", resp.StatusCode, 200, data)

	resp, data = auth("POST", "/v1/wallet/withdraw/sol", map[string]any{"amount": 11.0})
	if resp.StatusCode != http.StatusForbidden {
		fatalf("D large withdraw unsigned: want 403 got %d %s", resp.StatusCode, string(data))
	}
	fmt.Println("OK D large withdraw without signature -> 403")

	nonce := fmt.Sprintf("%d", time.Now().Unix())
	msg := fmt.Sprintf("withdraw:%s:%.6f", nonce, 11.0)
	sig := base58.Encode(ed25519.Sign(priv, []byte(msg)))
	resp, data = auth("POST", "/v1/wallet/withdraw/sol", map[string]any{
		"amount":    11.0,
		"nonce":     nonce,
		"signature": sig,
	})
	if resp.StatusCode == http.StatusForbidden && bytes.Contains(data, []byte("signature")) {
		fatalf("E large withdraw signed: still signature forbidden: %s", string(data))
	}
	fmt.Printf("OK E large withdraw signed -> %d\n", resp.StatusCode)

	resp, data = auth("POST", "/v1/wallet/withdraw/sol", map[string]any{"amount": 0.01})
	if resp.StatusCode == http.StatusForbidden && bytes.Contains(data, []byte("signature")) {
		fatalf("C small withdraw: unexpected signature required: %s", string(data))
	}
	fmt.Printf("OK C small withdraw -> %d\n", resp.StatusCode)

	resp, data = auth("GET", "/v1/wallet/security-flags", nil)
	check("H GET security-flags", resp.StatusCode, 200, data)

	fmt.Println("\nAPI smoke done. B (deposit) and G (non-whitelist) need funded wallet / manual setup.")
}

func authReq(base, token, method, path string, body any) (*http.Response, []byte) {
	return authReqClient(&http.Client{Timeout: 30 * time.Second}, base, token, method, path, body)
}

func authReqClient(client *http.Client, base, token, method, path string, body any) (*http.Response, []byte) {
	var r io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		r = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, base+path, r)
	req.Header.Set("Authorization", "Bearer "+token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := client.Do(req)
	if err != nil {
		fatalf("request %s %s: %v", method, path, err)
	}
	data, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	return resp, data
}

func walletLogin(base, addr string, priv ed25519.PrivateKey) string {
	chBody, _ := json.Marshal(map[string]string{"address": addr})
	chResp, err := http.Post(base+"/v1/auth/wallet/challenge", "application/json", bytes.NewReader(chBody))
	if err != nil {
		fatalf("challenge: %v", err)
	}
	chData, _ := io.ReadAll(chResp.Body)
	chResp.Body.Close()
	if chResp.StatusCode != 200 {
		fatalf("challenge status %d: %s", chResp.StatusCode, string(chData))
	}
	var ch struct {
		Message string `json:"message"`
	}
	if err := json.Unmarshal(chData, &ch); err != nil {
		fatalf("challenge json: %v", err)
	}
	sig := base58.Encode(ed25519.Sign(priv, []byte(ch.Message)))
	loginBody, _ := json.Marshal(map[string]string{
		"address":   addr,
		"signature": sig,
		"nonce":     ch.Message,
	})
	loginResp, err := http.Post(base+"/v1/auth/wallet/login", "application/json", bytes.NewReader(loginBody))
	if err != nil {
		fatalf("login: %v", err)
	}
	loginData, _ := io.ReadAll(loginResp.Body)
	loginResp.Body.Close()
	if loginResp.StatusCode != 200 {
		fatalf("login status %d: %s", loginResp.StatusCode, string(loginData))
	}
	var sess struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(loginData, &sess); err != nil {
		fatalf("login json: %v body %s", err, string(loginData))
	}
	if sess.Token == "" {
		fatalf("empty token in %s", string(loginData))
	}
	return sess.Token
}

func check(label string, code, want int, data []byte) {
	if code != want {
		fatalf("%s: want %d got %d %s", label, want, code, string(data))
	}
	fmt.Printf("OK %s -> %d\n", label, code)
}

func fatalf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "FAIL "+format+"\n", args...)
	os.Exit(1)
}
