package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func stubProbeEdgeNode(t *testing.T, fn func(ctx context.Context, gatewayNodeID string) (edgePingResult, error)) {
	t.Helper()
	orig := probeEdgeNode
	probeEdgeNode = fn
	t.Cleanup(func() { probeEdgeNode = orig })
}

func pingRouter(userID uuid.UUID) *gin.Engine {
	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", userID)
		c.Next()
	})
	r.POST("/provider/nodes/:id/ping", pingProviderNode)
	r.POST("/provider/nodes/:id/heartbeat", nodeHeartbeat)
	return r
}

func createVerifiedNode(t *testing.T, userID uuid.UUID, lastSeen time.Time) models.ProviderNode {
	t.Helper()
	node := models.ProviderNode{
		ID:                      uuid.New(),
		UserID:                  userID,
		Name:                    "ping-node",
		Status:                  models.NodeOnline,
		LastSeenAt:              &lastSeen,
		LatestHeartbeatVerified: true,
		LatestHeartbeatSigner:   "signer-key",
	}
	if err := db.DB.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}
	return node
}

func postRawJSON(r *gin.Engine, path string, body []byte) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestPingProviderNodeReportsReplyAndWritesNothing(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "provider_nodes")
	gin.SetMode(gin.TestMode)

	user := testutil.CreateTestUser(t, testutil.UniqueEmail("ping-ok"), "provider")
	lastSeen := time.Now().Add(-time.Hour).UTC().Truncate(time.Second)
	node := createVerifiedNode(t, user.ID, lastSeen)

	var probed string
	stubProbeEdgeNode(t, func(_ context.Context, gatewayNodeID string) (edgePingResult, error) {
		probed = gatewayNodeID
		rtt := int64(42)
		return edgePingResult{Reachable: true, RTTMs: &rtt}, nil
	})

	w := postRawJSON(pingRouter(user.ID), "/provider/nodes/"+node.ID.String()+"/ping", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var payload map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if payload["alive"] != true || payload["rtt_ms"] != float64(42) {
		t.Fatalf("unexpected payload %v", payload)
	}
	if probed != "node_"+user.ID.String() {
		t.Fatalf("probed %q, want node_%s", probed, user.ID)
	}

	var after models.ProviderNode
	if err := db.DB.Where("id = ?", node.ID).First(&after).Error; err != nil {
		t.Fatalf("reload: %v", err)
	}
	if after.LastSeenAt == nil || !after.LastSeenAt.Equal(lastSeen) {
		t.Fatalf("last_seen_at changed: %v want %v", after.LastSeenAt, lastSeen)
	}
	if !after.LatestHeartbeatVerified || after.LatestHeartbeatVerificationError != "" {
		t.Fatalf("proof fields changed: verified=%v err=%q", after.LatestHeartbeatVerified, after.LatestHeartbeatVerificationError)
	}
}

func TestPingProviderNodeRejectsOtherUsersNode(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "provider_nodes")
	gin.SetMode(gin.TestMode)

	owner := testutil.CreateTestUser(t, testutil.UniqueEmail("ping-owner"), "provider")
	other := testutil.CreateTestUser(t, testutil.UniqueEmail("ping-other"), "provider")
	node := createVerifiedNode(t, owner.ID, time.Now())

	stubProbeEdgeNode(t, func(context.Context, string) (edgePingResult, error) {
		t.Fatal("probe must not run for a node the caller does not own")
		return edgePingResult{}, nil
	})

	w := postRawJSON(pingRouter(other.ID), "/provider/nodes/"+node.ID.String()+"/ping", nil)
	if w.Code != http.StatusNotFound {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestPingProviderNodeGatewayUnreachable(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "provider_nodes")
	gin.SetMode(gin.TestMode)

	user := testutil.CreateTestUser(t, testutil.UniqueEmail("ping-down"), "provider")
	node := createVerifiedNode(t, user.ID, time.Now())

	stubProbeEdgeNode(t, func(context.Context, string) (edgePingResult, error) {
		return edgePingResult{}, errors.New("dial tcp: connection refused")
	})

	w := postRawJSON(pingRouter(user.ID), "/provider/nodes/"+node.ID.String()+"/ping", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var payload map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if payload["alive"] != false || payload["reason"] != "gateway_unreachable" {
		t.Fatalf("unexpected payload %v", payload)
	}
}

func TestNodeHeartbeatUnsignedKeepsVerifiedProof(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "provider_nodes")
	gin.SetMode(gin.TestMode)
	t.Setenv("PROVIDER_SIGNATURE_MODE", "observe")

	user := testutil.CreateTestUser(t, testutil.UniqueEmail("hb-unsigned"), "provider")
	node := createVerifiedNode(t, user.ID, time.Now().Add(-time.Minute))

	w := postRawJSON(pingRouter(user.ID), "/provider/nodes/"+node.ID.String()+"/heartbeat", []byte(`{}`))
	if w.Code != http.StatusOK {
		t.Fatalf("heartbeat status=%d body=%s", w.Code, w.Body.String())
	}

	var after models.ProviderNode
	if err := db.DB.Where("id = ?", node.ID).First(&after).Error; err != nil {
		t.Fatalf("reload: %v", err)
	}
	if !after.LatestHeartbeatVerified || after.LatestHeartbeatSigner != "signer-key" || after.LatestHeartbeatVerificationError != "" {
		t.Fatalf("unsigned heartbeat overwrote proof: verified=%v signer=%q err=%q",
			after.LatestHeartbeatVerified, after.LatestHeartbeatSigner, after.LatestHeartbeatVerificationError)
	}
}
