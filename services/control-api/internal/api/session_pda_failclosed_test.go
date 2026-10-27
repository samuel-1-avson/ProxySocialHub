package api

import (
	"encoding/json"
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

func TestBlockDirectSessionWhenRequireSessionPDA(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("PROXYHUB_REQUIRE_SESSION_PDA", "true")
	t.Setenv("PROXYHUB_ALLOW_LEGACY_DIRECT_SESSIONS_IN_PROD", "true")
	t.Setenv("APP_ENV", "production")

	r := gin.New()
	r.POST("/v1/sessions", func(c *gin.Context) {
		if blockDeprecatedDirectSessionCreation(c, "direct_session") {
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/v1/sessions", nil))
	if w.Code != http.StatusGone {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var body map[string]interface{}
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body["code"] != "session_pda_required" {
		t.Fatalf("code=%v", body["code"])
	}
}

func TestIntentRequiresFundedSessionPDA_FundWithoutConfirm(t *testing.T) {
	t.Setenv("PROXYHUB_REQUIRE_SESSION_PDA", "true")
	rec := &models.SessionIntentRecord{
		ID:            uuid.New(),
		SessionPDA:    "SomePDA111111111111111111111111111111111111",
		PaymentMethod: paymentMethodSessionEscrowPending,
	}
	if !intentRequiresFundedSessionPDA(rec) {
		t.Fatal("fund-without-confirm must still require escrow")
	}

	// Legacy hole: payment_method already session_escrow but no confirm timestamp.
	rec.PaymentMethod = paymentMethodSessionEscrow
	if !intentRequiresFundedSessionPDA(rec) {
		t.Fatal("missing escrow_confirmed_at must still require escrow")
	}

	now := time.Now().UTC()
	rec.EscrowConfirmedAt = &now
	if intentRequiresFundedSessionPDA(rec) {
		t.Fatal("confirmed escrow must allow Active")
	}
}

func TestIntentRequiresFundedSessionPDA_FlagOff(t *testing.T) {
	t.Setenv("PROXYHUB_REQUIRE_SESSION_PDA", "false")
	rec := &models.SessionIntentRecord{ID: uuid.New()}
	if intentRequiresFundedSessionPDA(rec) {
		t.Fatal("flag off must not require session PDA")
	}
}

func TestInstantSessionAllowedWhenRequireSessionPDA(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("PROXYHUB_REQUIRE_SESSION_PDA", "true")

	r := gin.New()
	r.POST("/v1/sessions/instant", func(c *gin.Context) {
		if blockDeprecatedDirectSessionCreation(c, "instant_session") {
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/v1/sessions/instant", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestConfirmSessionEscrowFailClosedNoPDA(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("PROXYHUB_REQUIRE_SESSION_PDA", "true")
	testutil.SetupTestDB(t)

	userID := testutil.CreateTestUserID(t, "buyer")
	sid := uuid.New()
	sess := models.Session{
		ID:     sid,
		UserID: userID,
		Type:   models.SessionUniversal,
		Status: models.SessionPendingPayment,
		Config: "{}",
	}
	if err := db.DB.Create(&sess).Error; err != nil {
		t.Fatalf("create: %v", err)
	}

	r := gin.New()
	r.POST("/v1/sessions/:id/confirm-escrow", func(c *gin.Context) {
		c.Set("user_id", userID)
		confirmSessionEscrow(c)
	})
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/sessions/"+sid.String()+"/confirm-escrow", nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var body map[string]interface{}
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body["code"] != "session_pda_required" {
		t.Fatalf("code=%v body=%s", body["code"], w.Body.String())
	}
}
