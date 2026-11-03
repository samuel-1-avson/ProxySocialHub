package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func messagingRouter(userID uuid.UUID) *gin.Engine {
	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", userID)
		c.Next()
	})
	r.POST("/conversations", startConversation)
	r.GET("/conversations/:id/messages", getMessages)
	r.POST("/conversations/:id/messages", sendMessage)
	return r
}

func postJSONTo(r *gin.Engine, path string, body any) *httptest.ResponseRecorder {
	raw, _ := json.Marshal(body)
	req := httptest.NewRequest("POST", path, bytes.NewBuffer(raw))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func errorText(w *httptest.ResponseRecorder) string {
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	s, _ := resp["error"].(string)
	return s
}

func TestStartConversationRejectsBlankMessages(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "conversations", "messages")
	a := testutil.CreateTestUser(t, testutil.UniqueEmail("blank_a"), "buyer")
	b := testutil.CreateTestUser(t, testutil.UniqueEmail("blank_b"), "provider")
	r := messagingRouter(a.ID)

	for _, msg := range []string{"", "   \n\t "} {
		w := postJSONTo(r, "/conversations", map[string]any{"recipient_id": b.ID, "message": msg})
		if w.Code != http.StatusBadRequest {
			t.Fatalf("message %q: want 400, got %d: %s", msg, w.Code, w.Body.String())
		}
		if got := errorText(w); got != "Write a message first." {
			t.Errorf("message %q: error = %q", msg, got)
		}
	}
	var n int64
	db.Social().Model(&models.Conversation{}).Where("participant1 = ?", a.ID).Count(&n)
	if n != 0 {
		t.Errorf("a rejected message must not leave an empty conversation behind, found %d", n)
	}
}

func TestStartConversationMasksPersonalDetails(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "conversations", "messages")
	a := testutil.CreateTestUser(t, testutil.UniqueEmail("mask_a"), "buyer")
	b := testutil.CreateTestUser(t, testutil.UniqueEmail("mask_b"), "provider")
	r := messagingRouter(a.ID)

	w := postJSONTo(r, "/conversations", map[string]any{"recipient_id": b.ID, "message": "mail me at secret.person@example.com"})
	if w.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d: %s", w.Code, w.Body.String())
	}
	var stored models.Message
	if err := db.Social().Order("created_at DESC").First(&stored).Error; err != nil {
		t.Fatal(err)
	}
	if strings.Contains(stored.Content, "secret.person@example.com") {
		t.Errorf("the first message kept an email address: %q", stored.Content)
	}
}

func TestSendMessageRules(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "conversations", "messages")
	a := testutil.CreateTestUser(t, testutil.UniqueEmail("rules_a"), "buyer")
	b := testutil.CreateTestUser(t, testutil.UniqueEmail("rules_b"), "provider")
	conv := models.Conversation{Participant1: a.ID, Participant2: b.ID}
	if err := db.DB.Create(&conv).Error; err != nil {
		t.Fatal(err)
	}
	r := messagingRouter(a.ID)
	path := "/conversations/" + conv.ID.String() + "/messages"

	if w := postJSONTo(r, path, map[string]any{"content": "   "}); w.Code != http.StatusBadRequest || errorText(w) != "Write a message first." {
		t.Errorf("blank send = %d %q", w.Code, errorText(w))
	}
	if w := postJSONTo(r, path, map[string]any{"content": strings.Repeat("x", 2001)}); w.Code != http.StatusBadRequest || errorText(w) != "Messages can be at most 2000 characters." {
		t.Errorf("too long = %d %q", w.Code, errorText(w))
	}
	if w := postJSONTo(r, path, map[string]any{"content": strings.Repeat("é", 2000)}); w.Code != http.StatusCreated {
		t.Errorf("2000 characters (multi-byte) = %d: %s", w.Code, w.Body.String())
	}
}

func TestGetMessagesBlanksDeletedContent(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "conversations", "messages")
	a := testutil.CreateTestUser(t, testutil.UniqueEmail("del_a"), "buyer")
	b := testutil.CreateTestUser(t, testutil.UniqueEmail("del_b"), "provider")
	conv := models.Conversation{Participant1: a.ID, Participant2: b.ID}
	if err := db.DB.Create(&conv).Error; err != nil {
		t.Fatal(err)
	}
	gone := models.Message{ConversationID: conv.ID, SenderID: b.ID, Content: "private words", IsDeleted: true}
	kept := models.Message{ConversationID: conv.ID, SenderID: b.ID, Content: "still here"}
	db.DB.Create(&gone)
	db.DB.Create(&kept)

	w := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/conversations/"+conv.ID.String()+"/messages", nil)
	messagingRouter(a.ID).ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", w.Code)
	}
	body := w.Body.String()
	if strings.Contains(body, "private words") {
		t.Errorf("a deleted message still carries its content: %s", body)
	}
	if !strings.Contains(body, "still here") || !strings.Contains(body, `"is_deleted":true`) {
		t.Errorf("expected the kept message and the deleted marker in: %s", body)
	}
}
