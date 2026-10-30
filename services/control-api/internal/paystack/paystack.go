// Package paystack is a minimal client for the Paystack payments API: start a
// transaction, verify it server-side, refund it, and check webhook signatures.
// Only the secret key is used; it never leaves the server.
package paystack

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// ErrNotConfigured means PAYSTACK_SECRET_KEY is unset.
var ErrNotConfigured = errors.New("paystack: PAYSTACK_SECRET_KEY is not set")

// BaseURL is the API root; tests point it at an httptest server.
var BaseURL = "https://api.paystack.co"

var httpClient = &http.Client{Timeout: 20 * time.Second}

func secretKey() string { return strings.TrimSpace(os.Getenv("PAYSTACK_SECRET_KEY")) }

// Configured reports whether a secret key is set.
func Configured() bool { return secretKey() != "" }

// IsTestKey reports whether the configured key is a test-mode key.
func IsTestKey() bool { return strings.HasPrefix(secretKey(), "sk_test_") }

type envelope struct {
	Status  bool            `json:"status"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data"`
}

func call(ctx context.Context, method, path string, body any, out any) error {
	key := secretKey()
	if key == "" {
		return ErrNotConfigured
	}
	var reader io.Reader
	if body != nil {
		buf, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(buf)
	}
	req, err := http.NewRequestWithContext(ctx, method, BaseURL+path, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("paystack: %s %s: %w", method, path, err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return err
	}
	var env envelope
	if err := json.Unmarshal(raw, &env); err != nil {
		return fmt.Errorf("paystack: %s %s: HTTP %d, unreadable body", method, path, resp.StatusCode)
	}
	if resp.StatusCode >= 300 || !env.Status {
		return fmt.Errorf("paystack: %s %s: HTTP %d: %s", method, path, resp.StatusCode, env.Message)
	}
	if out != nil {
		if err := json.Unmarshal(env.Data, out); err != nil {
			return fmt.Errorf("paystack: decode %s: %w", path, err)
		}
	}
	return nil
}

// InitializeRequest starts a payment. Amount is in the currency's minor unit
// (pesewas for GHS).
type InitializeRequest struct {
	Email       string         `json:"email"`
	Amount      int64          `json:"amount"`
	Currency    string         `json:"currency"`
	Reference   string         `json:"reference"`
	CallbackURL string         `json:"callback_url,omitempty"`
	Metadata    map[string]any `json:"metadata,omitempty"`
}

// InitializeResult is what the browser needs to open the Paystack popup.
type InitializeResult struct {
	AuthorizationURL string `json:"authorization_url"`
	AccessCode       string `json:"access_code"`
	Reference        string `json:"reference"`
}

// Initialize creates a transaction (POST /transaction/initialize).
func Initialize(ctx context.Context, req InitializeRequest) (*InitializeResult, error) {
	var out InitializeResult
	if err := call(ctx, http.MethodPost, "/transaction/initialize", req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// Transaction is the subset of a verified transaction we rely on.
type Transaction struct {
	ID        int64  `json:"id"`
	Status    string `json:"status"`
	Reference string `json:"reference"`
	Amount    int64  `json:"amount"`
	Currency  string `json:"currency"`
	PaidAt    string `json:"paid_at"`
}

// Verify fetches a transaction by reference (GET /transaction/verify/:reference).
// Callers must still compare amount, currency and reference with what they quoted.
func Verify(ctx context.Context, reference string) (*Transaction, error) {
	var out Transaction
	if err := call(ctx, http.MethodGet, "/transaction/verify/"+url.PathEscape(reference), nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// Refund refunds a transaction in full (POST /refund).
func Refund(ctx context.Context, reference string) error {
	return call(ctx, http.MethodPost, "/refund", map[string]any{"transaction": reference}, nil)
}

// ValidSignature checks the x-paystack-signature header: hex HMAC-SHA512 of the
// raw request body, keyed with the secret key.
func ValidSignature(rawBody []byte, header string) bool {
	key := secretKey()
	if key == "" || header == "" {
		return false
	}
	mac := hmac.New(sha512.New, []byte(key))
	mac.Write(rawBody)
	want := mac.Sum(nil)
	got, err := hex.DecodeString(strings.TrimSpace(header))
	if err != nil {
		return false
	}
	return hmac.Equal(want, got)
}
