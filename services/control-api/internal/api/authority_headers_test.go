package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func assertAuthorityHeaders(t *testing.T, w *httptest.ResponseRecorder, mode, chainScope, dbRole string) {
	t.Helper()

	if got := w.Header().Get("X-ProxyHubb-Authority-Mode"); got != mode {
		t.Fatalf("expected X-ProxyHubb-Authority-Mode=%q, got %q", mode, got)
	}
	if got := w.Header().Get("X-ProxyHubb-Authority-Chain-Scope"); got != chainScope {
		t.Fatalf("expected X-ProxyHubb-Authority-Chain-Scope=%q, got %q", chainScope, got)
	}
	if got := w.Header().Get("X-ProxyHubb-Authority-DB-Role"); got != dbRole {
		t.Fatalf("expected X-ProxyHubb-Authority-DB-Role=%q, got %q", dbRole, got)
	}
}

func TestLegacyEscrowDisputeEndpointsReturnGone(t *testing.T) {
	r := setupTestRouter()
	RegisterEscrowRoutes(r.Group("/"))

	tests := []struct {
		name       string
		path       string
		body       string
		expectText string
	}{
		{
			name:       "jury-vote disabled",
			path:       "/escrow/test-order/jury-vote",
			body:       `{"vote":"buyer_wins"}`,
			expectText: "disabled",
		},
		{
			name:       "resolve disabled",
			path:       "/escrow/test-order/resolve",
			body:       `{"decision":"refund"}`,
			expectText: "disabled",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, tc.path, strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != http.StatusGone {
				t.Fatalf("expected status %d, got %d, body=%s", http.StatusGone, w.Code, w.Body.String())
			}

			assertAuthorityHeaders(t, w, authorityModeChainAuthoritative, "required", "none")

			if !strings.Contains(strings.ToLower(w.Body.String()), tc.expectText) {
				t.Fatalf("expected response body to contain %q, got %s", tc.expectText, w.Body.String())
			}
		})
	}
}

func TestAuthorityHeadersCoveragePhase1(t *testing.T) {
	tests := []struct {
		name       string
		method     string
		path       string
		body       string
		setupRoute func() *httptest.ResponseRecorder
		expected   [3]string
	}{
		{
			name:   "dispute create",
			method: http.MethodPost,
			path:   "/disputes",
			body:   `{}`,
			setupRoute: func() *httptest.ResponseRecorder {
				r := setupTestRouter()
				RegisterDisputeRoutes(r.Group("/"))
				req := httptest.NewRequest(http.MethodPost, "/disputes", strings.NewReader(`{}`))
				req.Header.Set("Content-Type", "application/json")
				w := httptest.NewRecorder()
				r.ServeHTTP(w, req)
				return w
			},
			expected: [3]string{authorityModeDBAuthoritative, "none", "source_of_truth"},
		},
		{
			name:   "order create",
			method: http.MethodPost,
			path:   "/orders",
			body:   `{}`,
			setupRoute: func() *httptest.ResponseRecorder {
				r := setupTestRouter()
				RegisterOrderRoutes(r.Group("/"))
				req := httptest.NewRequest(http.MethodPost, "/orders", strings.NewReader(`{}`))
				req.Header.Set("Content-Type", "application/json")
				w := httptest.NewRecorder()
				r.ServeHTTP(w, req)
				return w
			},
			expected: [3]string{authorityModeDBAuthoritative, "none", "source_of_truth"},
		},
		{
			name:   "channel open",
			method: http.MethodPost,
			path:   "/channels/open",
			body:   `{}`,
			setupRoute: func() *httptest.ResponseRecorder {
				r := setupTestRouter()
				RegisterChannelRoutes(r.Group("/"))
				req := httptest.NewRequest(http.MethodPost, "/channels/open", strings.NewReader(`{}`))
				req.Header.Set("Content-Type", "application/json")
				w := httptest.NewRecorder()
				r.ServeHTTP(w, req)
				return w
			},
			expected: [3]string{authorityModeHybridAsyncChain, "async_write_settlement", "source_of_truth"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			w := tc.setupRoute()
			assertAuthorityHeaders(t, w, tc.expected[0], tc.expected[1], tc.expected[2])
		})
	}
}

func TestGovernanceMutationEndpointsFailClosedWhenChainUnavailable(t *testing.T) {
	r := setupTestRouter()
	RegisterGovernanceRoutes(r.Group("/"))

	tests := []struct {
		name         string
		path         string
		body         string
		expectedRole string
	}{
		{
			name:         "create fail-closed",
			path:         "/governance/proposals",
			body:         `{"title":"t","description":"d","duration_days":1}`,
			expectedRole: "mirror",
		},
		{
			name:         "vote build fail-closed",
			path:         "/governance/proposals/test-proposal-id/vote/build",
			body:         `{"choice":"yes","signature":"sig","wallet_address":"wallet"}`,
			expectedRole: "mirror",
		},
		{
			name:         "vote relay fail-closed",
			path:         "/governance/proposals/test-proposal-id/vote/relay",
			body:         `{"wallet_address":"wallet","signed_transaction_base64":"AAAA"}`,
			expectedRole: "none",
		},
		{
			name:         "vote verify/mirror fail-closed",
			path:         "/governance/proposals/test-proposal-id/vote",
			body:         `{"choice":"yes","signature":"sig","wallet_address":"wallet","on_chain_tx_sig":"tx"}`,
			expectedRole: "mirror",
		},
		{
			name:         "execute fail-closed",
			path:         "/governance/proposals/test-proposal-id/execute",
			body:         `{}`,
			expectedRole: "mirror",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, tc.path, strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != http.StatusServiceUnavailable {
				t.Fatalf("expected status %d, got %d, body=%s", http.StatusServiceUnavailable, w.Code, w.Body.String())
			}

			assertAuthorityHeaders(t, w, authorityModeChainAuthoritative, "required", tc.expectedRole)

			if !strings.Contains(strings.ToLower(w.Body.String()), "not ready") {
				t.Fatalf("expected response body to contain %q, got %s", "not ready", w.Body.String())
			}
		})
	}
}

func TestAdminGovernanceCancelEndpointReturnGone(t *testing.T) {
	r := setupTestRouter()
	r.POST("/admin/governance/proposals/:id/cancel", adminCancelProposal)

	req := httptest.NewRequest(http.MethodPost, "/admin/governance/proposals/test-proposal-id/cancel", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusGone {
		t.Fatalf("expected status %d, got %d, body=%s", http.StatusGone, w.Code, w.Body.String())
	}

	assertAuthorityHeaders(t, w, authorityModeChainAuthoritative, "required", "none")

	if !strings.Contains(strings.ToLower(w.Body.String()), "disabled") {
		t.Fatalf("expected response body to contain %q, got %s", "disabled", w.Body.String())
	}
}
