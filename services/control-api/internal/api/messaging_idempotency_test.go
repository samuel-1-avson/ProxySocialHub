package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

// F05: checked, transactional, idempotent sends — including the first
// message of a conversation, which must follow the same masking and
// notification rules as subsequent sends.

func f05Send(t *testing.T, r *gin.Engine, path string, payload map[string]interface{}) *httptest.ResponseRecorder {
	t.Helper()
	body, _ := json.Marshal(payload)
	req := httptest.NewRequest("POST", path, bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestF05SendMessageIdempotentReplayCreatesOneMessage(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "conversations", "messages", "notifications", "notification_preferences")

	sender := testutil.CreateTestUser(t, testutil.UniqueEmail("f05sender"), "buyer")
	receiver := testutil.CreateTestUser(t, testutil.UniqueEmail("f05receiver"), "provider")
	conv := models.Conversation{Participant1: sender.ID, Participant2: receiver.ID}
	if err := db.DB.Create(&conv).Error; err != nil {
		t.Fatalf("create conversation: %v", err)
	}

	r := setupTestRouter()
	r.Use(func(c *gin.Context) { c.Set("user_id", sender.ID); c.Next() })
	r.POST("/conversations/:id/messages", sendMessage)

	payload := map[string]interface{}{"content": "hello once", "client_msg_id": "f05-key-replay-1"}
	first := f05Send(t, r, "/conversations/"+conv.ID.String()+"/messages", payload)
	if first.Code != http.StatusCreated {
		t.Fatalf("first send: expected 201, got %d. Body: %s", first.Code, first.Body.String())
	}
	second := f05Send(t, r, "/conversations/"+conv.ID.String()+"/messages", payload)
	if second.Code != http.StatusCreated {
		t.Fatalf("replay: expected 201, got %d. Body: %s", second.Code, second.Body.String())
	}

	var firstMsg, secondMsg models.Message
	json.Unmarshal(first.Body.Bytes(), &firstMsg)
	json.Unmarshal(second.Body.Bytes(), &secondMsg)
	if firstMsg.ID != secondMsg.ID {
		t.Fatalf("replay must return the same message, got %s then %s", firstMsg.ID, secondMsg.ID)
	}

	var msgCount int64
	db.DB.Model(&models.Message{}).Where("conversation_id = ?", conv.ID).Count(&msgCount)
	if msgCount != 1 {
		t.Fatalf("expected exactly 1 stored message, got %d", msgCount)
	}
	var notifCount int64
	db.DB.Model(&models.Notification{}).Where("user_id = ? AND type = ?", receiver.ID, models.NotificationMessage).Count(&notifCount)
	if notifCount != 1 {
		t.Fatalf("expected exactly 1 notification, got %d", notifCount)
	}
}

func TestF05StartConversationMasksAndNotifiesFirstMessage(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "conversations", "messages", "notifications", "notification_preferences")

	sender := testutil.CreateTestUser(t, testutil.UniqueEmail("f05starter"), "buyer")
	receiver := testutil.CreateTestUser(t, testutil.UniqueEmail("f05target"), "provider")

	r := setupTestRouter()
	r.Use(func(c *gin.Context) { c.Set("user_id", sender.ID); c.Next() })
	r.POST("/conversations", startConversation)

	w := f05Send(t, r, "/conversations", map[string]interface{}{
		"recipient_id":  receiver.ID,
		"message":       "reach me at person@example.com please",
		"client_msg_id": "f05-key-start-1",
	})
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d. Body: %s", w.Code, w.Body.String())
	}

	var stored models.Message
	if err := db.DB.First(&stored, "sender_id = ?", sender.ID).Error; err != nil {
		t.Fatalf("load stored message: %v", err)
	}
	if strings.Contains(stored.Content, "person@example.com") {
		t.Fatalf("first message must be PII-masked like later sends, stored: %q", stored.Content)
	}
	if !strings.Contains(stored.Content, "@example.com") {
		t.Fatalf("expected masked email keeping domain, stored: %q", stored.Content)
	}

	var notif models.Notification
	if err := db.DB.First(&notif, "user_id = ? AND type = ?", receiver.ID, models.NotificationMessage).Error; err != nil {
		t.Fatalf("first message must notify recipient like later sends: %v", err)
	}
	if strings.Contains(notif.Body, "person@example.com") {
		t.Fatalf("notification body must not carry the unmasked email, got %q", notif.Body)
	}
}

func TestF05StartConversationReplayDoesNotDuplicate(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "conversations", "messages", "notifications", "notification_preferences")

	sender := testutil.CreateTestUser(t, testutil.UniqueEmail("f05starter2"), "buyer")
	receiver := testutil.CreateTestUser(t, testutil.UniqueEmail("f05target2"), "provider")

	r := setupTestRouter()
	r.Use(func(c *gin.Context) { c.Set("user_id", sender.ID); c.Next() })
	r.POST("/conversations", startConversation)

	payload := map[string]interface{}{
		"recipient_id":  receiver.ID,
		"message":       "first hello",
		"client_msg_id": "f05-key-start-replay",
	}
	first := f05Send(t, r, "/conversations", payload)
	if first.Code != http.StatusCreated {
		t.Fatalf("first start: expected 201, got %d. Body: %s", first.Code, first.Body.String())
	}
	second := f05Send(t, r, "/conversations", payload)
	if second.Code != http.StatusOK {
		t.Fatalf("replay start: expected 200 (existing conversation), got %d. Body: %s", second.Code, second.Body.String())
	}

	var convCount, msgCount, notifCount int64
	db.DB.Model(&models.Conversation{}).Count(&convCount)
	db.DB.Model(&models.Message{}).Count(&msgCount)
	db.DB.Model(&models.Notification{}).Where("user_id = ?", receiver.ID).Count(&notifCount)
	if convCount != 1 || msgCount != 1 {
		t.Fatalf("expected 1 conversation and 1 message after replay, got %d/%d", convCount, msgCount)
	}
	if notifCount != 1 {
		t.Fatalf("expected exactly 1 notification after replay, got %d", notifCount)
	}
}

func TestF05FailedInsertReturns500AndDeliversNothing(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "conversations", "messages", "notifications", "notification_preferences")

	sender := testutil.CreateTestUser(t, testutil.UniqueEmail("f05failsender"), "buyer")
	receiver := testutil.CreateTestUser(t, testutil.UniqueEmail("f05failreceiver"), "provider")
	conv := models.Conversation{Participant1: sender.ID, Participant2: receiver.ID}
	if err := db.DB.Create(&conv).Error; err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	// Reload so the baseline carries database timestamp precision.
	var baseline models.Conversation
	if err := db.DB.First(&baseline, "id = ?", conv.ID).Error; err != nil {
		t.Fatalf("reload conversation: %v", err)
	}
	originalLast := baseline.LastMessageAt

	// Inject a database failure for one marker content value.
	if err := db.DB.Exec(`
		CREATE OR REPLACE FUNCTION f05_fail_insert() RETURNS trigger AS $fn$
		BEGIN
			IF NEW.content LIKE '%F05-FAIL-MARKER%' THEN
				RAISE EXCEPTION 'injected insert failure';
			END IF;
			RETURN NEW;
		END;
		$fn$ LANGUAGE plpgsql;
	`).Error; err != nil {
		t.Fatalf("create failure function: %v", err)
	}
	if err := db.DB.Exec(`
		CREATE TRIGGER f05_fail_insert_trg BEFORE INSERT ON messages
		FOR EACH ROW EXECUTE FUNCTION f05_fail_insert();
	`).Error; err != nil {
		t.Fatalf("create failure trigger: %v", err)
	}
	t.Cleanup(func() {
		db.DB.Exec(`DROP TRIGGER IF EXISTS f05_fail_insert_trg ON messages`)
		db.DB.Exec(`DROP FUNCTION IF EXISTS f05_fail_insert()`)
	})

	r := setupTestRouter()
	r.Use(func(c *gin.Context) { c.Set("user_id", sender.ID); c.Next() })
	r.POST("/conversations/:id/messages", sendMessage)

	w := f05Send(t, r, "/conversations/"+conv.ID.String()+"/messages", map[string]interface{}{
		"content": "boom F05-FAIL-MARKER",
	})
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 on injected insert failure, got %d. Body: %s", w.Code, w.Body.String())
	}

	var msgCount, notifCount int64
	db.DB.Model(&models.Message{}).Where("conversation_id = ?", conv.ID).Count(&msgCount)
	db.DB.Model(&models.Notification{}).Where("user_id = ?", receiver.ID).Count(&notifCount)
	if msgCount != 0 {
		t.Fatalf("failed send must store nothing, got %d messages", msgCount)
	}
	if notifCount != 0 {
		t.Fatalf("failed send must notify nobody, got %d notifications", notifCount)
	}
	var reloaded models.Conversation
	db.DB.First(&reloaded, "id = ?", conv.ID)
	if !reloaded.LastMessageAt.Equal(originalLast) {
		t.Fatalf("failed send must not move last_message_at: %v -> %v", originalLast, reloaded.LastMessageAt)
	}
}
