package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

// F03: message lifecycle. Deleted messages are content-free tombstones on
// every ordinary read path (history, previews, search), while lifecycle
// metadata (is_deleted, edited_at, reply_to_id, type) reaches the client.

const f03DeletedText = "F03-ORIGINAL-DELETED-TEXT-12345"

type f03Fixture struct {
	alice   *models.User
	bob     *models.User
	conv    models.Conversation
	deleted models.Message
	edited  models.Message
}

func f03Seed(t *testing.T) f03Fixture {
	t.Helper()
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "conversations", "messages", "message_reactions")

	alice := testutil.CreateTestUser(t, testutil.UniqueEmail("f03alice"), "buyer")
	bob := testutil.CreateTestUser(t, testutil.UniqueEmail("f03bob"), "provider")
	conv := models.Conversation{Participant1: alice.ID, Participant2: bob.ID}
	if err := db.DB.Create(&conv).Error; err != nil {
		t.Fatalf("create conversation: %v", err)
	}

	deleted := models.Message{ConversationID: conv.ID, SenderID: bob.ID, Content: f03DeletedText, IsDeleted: true, Type: "text"}
	if err := db.DB.Create(&deleted).Error; err != nil {
		t.Fatalf("create deleted message: %v", err)
	}

	editedAt := time.Now().Add(-time.Minute)
	edited := models.Message{
		ConversationID: conv.ID,
		SenderID:       bob.ID,
		Content:        "edited reply text",
		Type:           "text",
		EditedAt:       &editedAt,
		ReplyToID:      &deleted.ID,
	}
	if err := db.DB.Create(&edited).Error; err != nil {
		t.Fatalf("create edited message: %v", err)
	}

	// Make the deleted message the conversation's last activity so the
	// preview path is exercised against it.
	if err := db.DB.Model(&models.Conversation{}).Where("id = ?", conv.ID).
		Update("last_message_at", time.Now().Add(time.Hour)).Error; err != nil {
		t.Fatalf("touch conversation: %v", err)
	}
	if err := db.DB.Model(&models.Message{}).Where("id = ?", deleted.ID).
		Update("created_at", time.Now().Add(time.Hour)).Error; err != nil {
		t.Fatalf("touch deleted message: %v", err)
	}

	return f03Fixture{alice: alice, bob: bob, conv: conv, deleted: deleted, edited: edited}
}

func TestF03HistoryReturnsTombstoneAndPreservesLifecycleFields(t *testing.T) {
	f := f03Seed(t)

	r := setupTestRouter()
	r.Use(func(c *gin.Context) { c.Set("user_id", f.alice.ID); c.Next() })
	r.GET("/conversations/:id/messages", getMessages)

	req := httptest.NewRequest("GET", "/conversations/"+f.conv.ID.String()+"/messages", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
	body := w.Body.String()
	if strings.Contains(body, f03DeletedText) {
		t.Fatalf("deleted message text leaked in history. Body: %s", body)
	}

	var resp struct {
		Messages []map[string]interface{} `json:"messages"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	var tombstone, edited map[string]interface{}
	for _, m := range resp.Messages {
		switch m["id"] {
		case f.deleted.ID.String():
			tombstone = m
		case f.edited.ID.String():
			edited = m
		}
	}
	if tombstone == nil || edited == nil {
		t.Fatalf("expected both messages present, got %v", resp.Messages)
	}
	if tombstone["is_deleted"] != true {
		t.Fatalf("expected is_deleted=true on tombstone, got %v", tombstone)
	}
	if content, _ := tombstone["content"].(string); content != "" {
		t.Fatalf("expected empty tombstone content, got %q", content)
	}
	if edited["edited_at"] == nil {
		t.Fatalf("expected edited_at preserved, got %v", edited)
	}
	if edited["reply_to_id"] != f.deleted.ID.String() {
		t.Fatalf("expected reply_to_id preserved, got %v", edited["reply_to_id"])
	}
	if edited["type"] != "text" {
		t.Fatalf("expected type preserved, got %v", edited["type"])
	}
}

func TestF03ConversationPreviewIsTombstoned(t *testing.T) {
	f := f03Seed(t)

	r := setupTestRouter()
	r.Use(func(c *gin.Context) { c.Set("user_id", f.alice.ID); c.Next() })
	r.GET("/conversations", getConversations)

	req := httptest.NewRequest("GET", "/conversations", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), f03DeletedText) {
		t.Fatalf("deleted message text leaked in conversation preview. Body: %s", w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `"is_deleted":true`) {
		t.Fatalf("expected preview tombstone flag. Body: %s", w.Body.String())
	}
}

func TestF03SearchNeverReturnsDeletedText(t *testing.T) {
	f := f03Seed(t)

	r := setupTestRouter()
	r.Use(func(c *gin.Context) { c.Set("user_id", f.alice.ID); c.Next() })
	r.GET("/conversations/:id/search", searchMessages)

	req := httptest.NewRequest("GET", "/conversations/"+f.conv.ID.String()+"/search?q=F03-ORIGINAL", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), f03DeletedText) {
		t.Fatalf("deleted message text leaked in search. Body: %s", w.Body.String())
	}
}

func TestF03DeleteThenRefetchIsTombstone(t *testing.T) {
	f := f03Seed(t)

	r := setupTestRouter()
	r.Use(func(c *gin.Context) { c.Set("user_id", f.bob.ID); c.Next() })
	r.DELETE("/conversations/:id/messages/:messageId", deleteMessage)
	r.GET("/conversations/:id/messages", getMessages)

	req := httptest.NewRequest("DELETE", "/conversations/"+f.conv.ID.String()+"/messages/"+f.edited.ID.String(), nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("delete: expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	req = httptest.NewRequest("GET", "/conversations/"+f.conv.ID.String()+"/messages", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("refetch: expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "edited reply text") {
		t.Fatalf("deleted text still returned after delete. Body: %s", w.Body.String())
	}
}

func TestF03EditDeletedMessageRejected(t *testing.T) {
	f := f03Seed(t)

	r := setupTestRouter()
	r.Use(func(c *gin.Context) { c.Set("user_id", f.bob.ID); c.Next() })
	r.PUT("/conversations/:id/messages/:messageId", editMessage)

	body, _ := json.Marshal(map[string]string{"content": "resurrected"})
	req := httptest.NewRequest("PUT", "/conversations/"+f.conv.ID.String()+"/messages/"+f.deleted.ID.String(), bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 editing a deleted message, got %d. Body: %s", w.Code, w.Body.String())
	}

	var stored models.Message
	if err := db.DB.First(&stored, "id = ?", f.deleted.ID).Error; err != nil {
		t.Fatalf("reload: %v", err)
	}
	if !stored.IsDeleted {
		t.Fatalf("message must stay deleted")
	}
}
