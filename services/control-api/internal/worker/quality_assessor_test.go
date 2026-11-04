package worker

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestQualityProbeUsesAuthenticatedManagementRoute(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.URL.Path != "/internal/providers/node_abc/quality-check" || r.Header.Get("X-Gateway-Auth") != "test-secret" {
			t.Errorf("unexpected management request: %s %s", r.Method, r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"samples":3,"successful_samples":3,"latency_p50_ms":100,"latency_p95_ms":200,"throughput_mbps":20,"bytes_transferred":786432}`))
	}))
	defer srv.Close()
	t.Setenv("EDGE_GATEWAY_MGMT_URL", srv.URL)
	t.Setenv("GATEWAY_SHARED_SECRET", "test-secret")
	m, err := probeQuality(context.Background(), "node_abc")
	if err != nil || m.SuccessfulSamples != 3 || m.BytesTransferred != 786432 {
		t.Fatalf("metrics=%+v error=%v", m, err)
	}
}

func TestQualityProbeInfrastructureFailureAndRedirectFailClosed(t *testing.T) {
	for _, status := range []int{http.StatusServiceUnavailable, http.StatusFound, http.StatusForbidden} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Location", "http://127.0.0.1:1")
				w.WriteHeader(status)
			}))
			defer srv.Close()
			t.Setenv("EDGE_GATEWAY_MGMT_URL", srv.URL)
			if _, err := probeQuality(context.Background(), "node_abc"); err == nil {
				t.Fatal("failed management request treated as measurements")
			}
		})
	}
}
