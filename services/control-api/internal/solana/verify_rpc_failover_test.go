package solana

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestVerifyTransactionFallsBackAfterHTTPFailure(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
		body   string
	}{
		{"plain_rate_limit", 429, "max usage reached"},
		{"html_gateway_failure", 502, "<html>upstream unavailable</html>"},
		{"json_with_failed_http_status", 503, `{"jsonrpc":"2.0","id":1,"result":{"slot":13,"meta":{"err":null}}}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			primaryCalls, fallbackCalls := 0, 0
			primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				primaryCalls++
				w.WriteHeader(tc.status)
				fmt.Fprint(w, tc.body)
			}))
			defer primary.Close()
			fallback := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				fallbackCalls++
				fmt.Fprint(w, `{"jsonrpc":"2.0","id":1,"result":{"slot":42,"meta":{"err":null}}}`)
			}))
			defer fallback.Close()
			t.Setenv("SOLANA_NETWORK", "mainnet-beta") // Only the two local test endpoints.
			t.Setenv("SOLANA_RPC_ENDPOINTS", primary.URL+","+fallback.URL)
			previous := rpcEndpoint
			rpcEndpoint = primary.URL
			t.Cleanup(func() { rpcEndpoint = previous })
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			result, err := VerifyTransaction(ctx, "public-test-signature")
			if err != nil || result == nil || result.Slot != 42 {
				t.Fatalf("expected the fallback's transaction, result=%+v error=%v", result, err)
			}
			if primaryCalls != 1 || fallbackCalls != 1 {
				t.Fatalf("RPC calls: primary=%d fallback=%d", primaryCalls, fallbackCalls)
			}
		})
	}
}

func TestVerifyTransactionDoesNotRetryAnOnChainFailure(t *testing.T) {
	fallbackCalls := 0
	primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"jsonrpc":"2.0","id":1,"result":{"slot":42,"meta":{"err":{"InstructionError":[0,"InvalidArgument"]}}}}`)
	}))
	defer primary.Close()
	fallback := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fallbackCalls++ }))
	defer fallback.Close()
	t.Setenv("SOLANA_NETWORK", "mainnet-beta")
	t.Setenv("SOLANA_RPC_ENDPOINTS", primary.URL+","+fallback.URL)
	previous := rpcEndpoint
	rpcEndpoint = primary.URL
	t.Cleanup(func() { rpcEndpoint = previous })
	_, err := VerifyTransaction(context.Background(), "failed-test-signature")
	if err == nil || !strings.Contains(err.Error(), "failed on-chain") || fallbackCalls != 0 {
		t.Fatalf("must reject the chain failure without searching for a different outcome: error=%v fallbacks=%d", err, fallbackCalls)
	}
}
