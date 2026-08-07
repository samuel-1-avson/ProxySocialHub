package solana

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/gagliardetto/solana-go/rpc"
	"github.com/gagliardetto/solana-go/rpc/jsonrpc"
)

const (
	DefaultDevnetRPCEndpoint = "https://api.devnet.solana.com"
	DefaultDevnetWSEndpoint  = "wss://api.devnet.solana.com"
)

// RPCEndpointsFromEnv returns normalized HTTP(S) RPC endpoints from env.
func RPCEndpointsFromEnv() []string {
	if endpoints := NormalizeRPCEndpoints(strings.Split(os.Getenv("SOLANA_RPC_ENDPOINTS"), ",")); len(endpoints) > 0 {
		return endpoints
	}
	return NormalizeRPCEndpoints([]string{os.Getenv("SOLANA_RPC_ENDPOINT"), DefaultDevnetRPCEndpoint})
}

func PrimaryRPCEndpointFromEnv() string {
	endpoints := RPCEndpointsFromEnv()
	if len(endpoints) == 0 {
		return DefaultDevnetRPCEndpoint
	}
	return endpoints[0]
}

func WSEndpointFromEnv(rpcEndpoints []string) string {
	if endpoint := strings.TrimSpace(os.Getenv("SOLANA_WS_ENDPOINT")); endpoint != "" {
		if normalized, err := NormalizeWSEndpoint(endpoint); err == nil {
			return normalized
		}
	}
	if len(rpcEndpoints) == 0 {
		return DefaultDevnetWSEndpoint
	}
	if endpoint, err := DeriveWSEndpoint(rpcEndpoints[0]); err == nil {
		return endpoint
	}
	return DefaultDevnetWSEndpoint
}

func NormalizeRPCEndpoints(raw []string) []string {
	seen := map[string]struct{}{}
	endpoints := make([]string, 0, len(raw))
	for _, endpoint := range raw {
		normalized, err := NormalizeRPCEndpoint(endpoint)
		if err != nil {
			continue
		}
		if _, ok := seen[normalized]; ok {
			continue
		}
		seen[normalized] = struct{}{}
		endpoints = append(endpoints, normalized)
	}
	return endpoints
}

func NormalizeRPCEndpoint(endpoint string) (string, error) {
	endpoint = strings.TrimSpace(endpoint)
	if endpoint == "" {
		return "", fmt.Errorf("empty Solana RPC endpoint")
	}
	if !strings.Contains(endpoint, "://") {
		endpoint = "https://" + endpoint
	}
	u, err := url.Parse(endpoint)
	if err != nil {
		return "", err
	}
	switch strings.ToLower(u.Scheme) {
	case "http", "https":
	case "ws":
		u.Scheme = "http"
	case "wss":
		u.Scheme = "https"
	default:
		return "", fmt.Errorf("unsupported Solana RPC scheme %q", u.Scheme)
	}
	if u.Host == "" {
		return "", fmt.Errorf("Solana RPC endpoint missing host")
	}
	return u.String(), nil
}

func NormalizeWSEndpoint(endpoint string) (string, error) {
	endpoint = strings.TrimSpace(endpoint)
	if endpoint == "" {
		return "", fmt.Errorf("empty Solana WS endpoint")
	}
	if !strings.Contains(endpoint, "://") {
		endpoint = "wss://" + endpoint
	}
	u, err := url.Parse(endpoint)
	if err != nil {
		return "", err
	}
	switch strings.ToLower(u.Scheme) {
	case "ws", "wss":
	case "http":
		u.Scheme = "ws"
	case "https":
		u.Scheme = "wss"
	default:
		return "", fmt.Errorf("unsupported Solana WS scheme %q", u.Scheme)
	}
	if u.Host == "" {
		return "", fmt.Errorf("Solana WS endpoint missing host")
	}
	return u.String(), nil
}

func DeriveWSEndpoint(rpcEndpoint string) (string, error) {
	endpoint, err := NormalizeRPCEndpoint(rpcEndpoint)
	if err != nil {
		return "", err
	}
	u, err := url.Parse(endpoint)
	if err != nil {
		return "", err
	}
	switch u.Scheme {
	case "http":
		u.Scheme = "ws"
	case "https":
		u.Scheme = "wss"
	}
	return u.String(), nil
}

func NewRPCClient(endpoint string) *rpc.Client {
	normalized, err := NormalizeRPCEndpoint(endpoint)
	if err != nil {
		normalized = DefaultDevnetRPCEndpoint
	}
	rpcClient := jsonrpc.NewClientWithOpts(normalized, &jsonrpc.RPCClientOpts{
		HTTPClient: NewRPCHTTPClient(),
	})
	return rpc.NewWithCustomRPCClient(rpcClient)
}

func NewRPCHTTPClient() *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = http.ProxyFromEnvironment
	transport.DialContext = (&net.Dialer{
		Timeout:   10 * time.Second,
		KeepAlive: 90 * time.Second,
	}).DialContext
	transport.TLSHandshakeTimeout = 10 * time.Second
	transport.ResponseHeaderTimeout = 20 * time.Second
	transport.ExpectContinueTimeout = 1 * time.Second
	return &http.Client{
		Transport: transport,
		Timeout:   30 * time.Second,
	}
}

// HealthyRPCEndpoints probes endpoints and returns them ordered healthy-first.
// Unhealthy endpoints are kept as fallbacks — dropping them left withdrawals
// stranded on a single rate-limited public RPC.
func HealthyRPCEndpoints(ctx context.Context, endpoints []string) []string {
	normalized := NormalizeRPCEndpoints(endpoints)
	if len(normalized) == 0 {
		normalized = []string{DefaultDevnetRPCEndpoint}
	}
	healthy := make([]string, 0, len(normalized))
	unhealthy := make([]string, 0, len(normalized))
	for _, endpoint := range normalized {
		probeCtx, cancel := context.WithTimeout(ctx, 6*time.Second)
		client := NewRPCClient(endpoint)
		if _, err := client.GetHealth(probeCtx); err == nil {
			healthy = append(healthy, endpoint)
		} else {
			unhealthy = append(unhealthy, endpoint)
		}
		cancel()
	}
	if len(healthy) == 0 {
		return normalized
	}
	return append(healthy, unhealthy...)
}
