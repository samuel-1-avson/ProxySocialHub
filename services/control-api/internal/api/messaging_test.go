package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func TestStartConversation_Success(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "conversations")

	// Create user1 and user2
	email1 := testutil.UniqueEmail("user1")
	user1 := testutil.CreateTestUser(t, email1, "buyer")

	email2 := testutil.UniqueEmail("user2")
	user2 := testutil.CreateTestUser(t, email2, "provider")

	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", user1.ID)
		c.Next()
	})
	r.POST("/conversations", startConversation)

	body := models.StartConversationRequest{
		RecipientID: user2.ID,
		Message:     "Initial message",
	}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/conversations", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated && w.Code != http.StatusOK {
		t.Errorf("Expected status 201 or 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	var conversation models.Conversation
	json.Unmarshal(w.Body.Bytes(), &conversation)

	if conversation.Participant1 != user1.ID && conversation.Participant2 != user1.ID {
		t.Errorf("User1 should be a participant")
	}
	if conversation.Participant1 != user2.ID && conversation.Participant2 != user2.ID {
		t.Errorf("User2 should be a participant")
	}
}

func TestSendMessage_Success(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "conversations", "messages")

	email1 := testutil.UniqueEmail("sender")
	sender := testutil.CreateTestUser(t, email1, "buyer")

	email2 := testutil.UniqueEmail("receiver")
	receiver := testutil.CreateTestUser(t, email2, "provider")

	// Create conversation
	conversation := models.Conversation{
		Participant1: sender.ID,
		Participant2: receiver.ID,
	}
	if err := db.DB.Create(&conversation).Error; err != nil {
		t.Fatalf("Failed to create conversation: %v", err)
	}

	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", sender.ID)
		c.Next()
	})
	r.POST("/conversations/:id/messages", sendMessage)

	body := models.SendMessageRequest{
		Content: "Hello there!",
	}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/conversations/"+conversation.ID.String()+"/messages", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("Expected status %d, got %d. Body: %s", http.StatusCreated, w.Code, w.Body.String())
	}

	var msg models.Message
	json.Unmarshal(w.Body.Bytes(), &msg)

	if msg.Content != "Hello there!" {
		t.Errorf("Expected content 'Hello there!', got '%s'", msg.Content)
	}
	if msg.SenderID != sender.ID {
		t.Errorf("Expected sender %s, got %s", sender.ID, msg.SenderID)
	}

	// Verify conversation updated
	var updatedConv models.Conversation
	db.DB.First(&updatedConv, "id = ?", conversation.ID)
	if updatedConv.LastMessageAt.IsZero() {
		t.Error("Conversation LastMessageAt should be updated")
	}
}

func TestGetMessages_Success(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "conversations", "messages")

	email1 := testutil.UniqueEmail("viewer")
	viewer := testutil.CreateTestUser(t, email1, "buyer")

	email2 := testutil.UniqueEmail("other")
	other := testutil.CreateTestUser(t, email2, "provider")

	conversation := models.Conversation{
		Participant1: viewer.ID,
		Participant2: other.ID,
	}
	db.DB.Create(&conversation)

	// Create messages
	msg1 := models.Message{
		ConversationID: conversation.ID,
		SenderID:       other.ID,
		Content:        "Hi",
	}
	msg2 := models.Message{
		ConversationID: conversation.ID,
		SenderID:       viewer.ID,
		Content:        "Hello",
	}
	db.DB.Create(&msg1)
	db.DB.Create(&msg2)

	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", viewer.ID)
		c.Next()
	})
	r.GET("/conversations/:id/messages", getMessages)

	req := httptest.NewRequest("GET", "/conversations/"+conversation.ID.String()+"/messages", nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status %d, got %d", http.StatusOK, w.Code)
	}

	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)

	msgs := response["messages"].([]interface{})
	if len(msgs) != 2 {
		t.Errorf("Expected 2 messages, got %d", len(msgs))
	}
}

func TestMarkAsRead_Success(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "conversations", "messages")

	email1 := testutil.UniqueEmail("reader")
	reader := testutil.CreateTestUser(t, email1, "buyer")

	email2 := testutil.UniqueEmail("sender_friend")
	sender := testutil.CreateTestUser(t, email2, "provider")

	conversation := models.Conversation{
		Participant1: reader.ID,
		Participant2: sender.ID,
	}
	db.DB.Create(&conversation)

	msg := models.Message{
		ConversationID: conversation.ID,
		SenderID:       sender.ID, // User1 receives this
		Content:        "Unread msg",
	}
	db.DB.Create(&msg)

	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", reader.ID)
		c.Next()
	})
	r.POST("/conversations/:id/read", markAsRead)

	req := httptest.NewRequest("POST", "/conversations/"+conversation.ID.String()+"/read", nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status %d, got %d", http.StatusOK, w.Code)
	}

	// Verify message read_at is set
	var updatedMsg models.Message
	db.DB.First(&updatedMsg, "id = ?", msg.ID)
	if updatedMsg.ReadAt == nil {
		t.Error("Message should be marked as read")
	}
}

func TestSendMessage_RejectsReplyToFromOtherConversation(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "conversations", "messages")

	sender := testutil.CreateTestUser(t, testutil.UniqueEmail("sender"), "buyer")
	receiver := testutil.CreateTestUser(t, testutil.UniqueEmail("receiver"), "provider")
	other := testutil.CreateTestUser(t, testutil.UniqueEmail("other"), "provider")

	conversation := models.Conversation{
		Participant1: sender.ID,
		Participant2: receiver.ID,
	}
	if err := db.DB.Create(&conversation).Error; err != nil {
		t.Fatalf("Failed to create conversation: %v", err)
	}

	otherConversation := models.Conversation{
		Participant1: sender.ID,
		Participant2: other.ID,
	}
	if err := db.DB.Create(&otherConversation).Error; err != nil {
		t.Fatalf("Failed to create other conversation: %v", err)
	}

	foreignMessage := models.Message{
		ConversationID: otherConversation.ID,
		SenderID:       other.ID,
		Content:        "different conversation",
	}
	if err := db.DB.Create(&foreignMessage).Error; err != nil {
		t.Fatalf("Failed to create foreign message: %v", err)
	}

	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", sender.ID)
		c.Next()
	})
	r.POST("/conversations/:id/messages", sendMessage)

	body := map[string]interface{}{
		"content":     "Replying",
		"reply_to_id": foreignMessage.ID,
	}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/conversations/"+conversation.ID.String()+"/messages", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("Expected status %d, got %d. Body: %s", http.StatusBadRequest, w.Code, w.Body.String())
	}
}

func TestSendMessage_CreatesDurableNotificationForRecipient(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "conversations", "messages", "notifications", "notification_preferences")

	sender := testutil.CreateTestUser(t, testutil.UniqueEmail("notify_sender"), "buyer")
	receiver := testutil.CreateTestUser(t, testutil.UniqueEmail("notify_receiver"), "provider")

	conversation := models.Conversation{
		Participant1: sender.ID,
		Participant2: receiver.ID,
	}
	if err := db.DB.Create(&conversation).Error; err != nil {
		t.Fatalf("Failed to create conversation: %v", err)
	}

	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", sender.ID)
		c.Next()
	})
	r.POST("/conversations/:id/messages", sendMessage)

	body := map[string]string{"content": "Hello provider"}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/conversations/"+conversation.ID.String()+"/messages", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("Expected status %d, got %d. Body: %s", http.StatusCreated, w.Code, w.Body.String())
	}

	var notification models.Notification
	if err := db.DB.First(&notification, "user_id = ? AND type = ?", receiver.ID, models.NotificationMessage).Error; err != nil {
		t.Fatalf("Expected message notification: %v", err)
	}
	if notification.ActorID == nil || *notification.ActorID != sender.ID {
		t.Fatalf("Expected actor %s, got %v", sender.ID, notification.ActorID)
	}
	if notification.TargetID == nil || *notification.TargetID != conversation.ID {
		t.Fatalf("Expected target conversation %s, got %v", conversation.ID, notification.TargetID)
	}
}

func TestSendMessage_RespectsNotificationPreferences(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "conversations", "messages", "notifications", "notification_preferences")

	sender := testutil.CreateTestUser(t, testutil.UniqueEmail("pref_sender"), "buyer")
	receiver := testutil.CreateTestUser(t, testutil.UniqueEmail("pref_receiver"), "provider")

	prefs := models.NotificationPreference{
		UserID:               receiver.ID,
		SocialInApp:          false,
		SocialEmail:          true,
		SocialPush:           false,
		BusinessInApp:        true,
		BusinessEmail:        true,
		BusinessPush:         true,
		CommunityInApp:       true,
		CommunityEmail:       true,
		CommunityPush:        false,
		SystemInApp:          true,
		SystemEmail:          true,
		SystemPush:           true,
		EmailDigestFrequency: "immediate",
		DigestDay:            "monday",
		DigestHour:           9,
	}
	if err := db.DB.Create(&prefs).Error; err != nil {
		t.Fatalf("Failed to create preferences: %v", err)
	}

	conversation := models.Conversation{
		Participant1: sender.ID,
		Participant2: receiver.ID,
	}
	if err := db.DB.Create(&conversation).Error; err != nil {
		t.Fatalf("Failed to create conversation: %v", err)
	}

	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", sender.ID)
		c.Next()
	})
	r.POST("/conversations/:id/messages", sendMessage)

	body := map[string]string{"content": "Hello provider"}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/conversations/"+conversation.ID.String()+"/messages", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("Expected status %d, got %d. Body: %s", http.StatusCreated, w.Code, w.Body.String())
	}

	var count int64
	db.DB.Model(&models.Notification{}).Where("user_id = ?", receiver.ID).Count(&count)
	if count != 0 {
		t.Fatalf("Expected notification preference to suppress message notification, got %d", count)
	}
}

func TestAddReaction_ForbiddenForNonParticipant(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "conversations", "messages", "message_reactions")

	participant := testutil.CreateTestUser(t, testutil.UniqueEmail("participant"), "buyer")
	otherParticipant := testutil.CreateTestUser(t, testutil.UniqueEmail("other_participant"), "provider")
	outsider := testutil.CreateTestUser(t, testutil.UniqueEmail("outsider"), "buyer")

	conversation := models.Conversation{
		Participant1: participant.ID,
		Participant2: otherParticipant.ID,
	}
	if err := db.DB.Create(&conversation).Error; err != nil {
		t.Fatalf("Failed to create conversation: %v", err)
	}

	msg := models.Message{
		ConversationID: conversation.ID,
		SenderID:       participant.ID,
		Content:        "private",
	}
	if err := db.DB.Create(&msg).Error; err != nil {
		t.Fatalf("Failed to create message: %v", err)
	}

	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", outsider.ID)
		c.Next()
	})
	r.POST("/messages/:messageId/reactions", addReaction)

	body := map[string]string{"emoji": "like"}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/messages/"+msg.ID.String()+"/reactions", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("Expected status %d, got %d. Body: %s", http.StatusForbidden, w.Code, w.Body.String())
	}
}

func TestAddReaction_SuccessForParticipant(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "conversations", "messages", "message_reactions")

	participant := testutil.CreateTestUser(t, testutil.UniqueEmail("participant"), "buyer")
	otherParticipant := testutil.CreateTestUser(t, testutil.UniqueEmail("other_participant"), "provider")

	conversation := models.Conversation{
		Participant1: participant.ID,
		Participant2: otherParticipant.ID,
	}
	if err := db.DB.Create(&conversation).Error; err != nil {
		t.Fatalf("Failed to create conversation: %v", err)
	}

	msg := models.Message{
		ConversationID: conversation.ID,
		SenderID:       otherParticipant.ID,
		Content:        "private",
	}
	if err := db.DB.Create(&msg).Error; err != nil {
		t.Fatalf("Failed to create message: %v", err)
	}

	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", participant.ID)
		c.Next()
	})
	r.POST("/messages/:messageId/reactions", addReaction)

	body := map[string]string{"emoji": "like"}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/messages/"+msg.ID.String()+"/reactions", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("Expected status %d, got %d. Body: %s", http.StatusCreated, w.Code, w.Body.String())
	}
}

func TestRemoveReaction_ForbiddenForNonParticipant(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "conversations", "messages", "message_reactions")

	participant := testutil.CreateTestUser(t, testutil.UniqueEmail("participant"), "buyer")
	otherParticipant := testutil.CreateTestUser(t, testutil.UniqueEmail("other_participant"), "provider")
	outsider := testutil.CreateTestUser(t, testutil.UniqueEmail("outsider"), "buyer")

	conversation := models.Conversation{
		Participant1: participant.ID,
		Participant2: otherParticipant.ID,
	}
	if err := db.DB.Create(&conversation).Error; err != nil {
		t.Fatalf("Failed to create conversation: %v", err)
	}

	msg := models.Message{
		ConversationID: conversation.ID,
		SenderID:       participant.ID,
		Content:        "private",
	}
	if err := db.DB.Create(&msg).Error; err != nil {
		t.Fatalf("Failed to create message: %v", err)
	}

	reaction := models.MessageReaction{
		MessageID: msg.ID,
		UserID:    participant.ID,
		Emoji:     "like",
	}
	if err := db.DB.Create(&reaction).Error; err != nil {
		t.Fatalf("Failed to create reaction: %v", err)
	}

	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", outsider.ID)
		c.Next()
	})
	r.DELETE("/messages/:messageId/reactions/:emoji", removeReaction)

	req := httptest.NewRequest("DELETE", "/messages/"+msg.ID.String()+"/reactions/like", nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("Expected status %d, got %d. Body: %s", http.StatusForbidden, w.Code, w.Body.String())
	}
}

func TestDeleteMessage_OnlySenderCanDelete(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "conversations", "messages")

	sender := testutil.CreateTestUser(t, testutil.UniqueEmail("sender"), "buyer")
	receiver := testutil.CreateTestUser(t, testutil.UniqueEmail("receiver"), "provider")

	conversation := models.Conversation{
		Participant1: sender.ID,
		Participant2: receiver.ID,
	}
	if err := db.DB.Create(&conversation).Error; err != nil {
		t.Fatalf("Failed to create conversation: %v", err)
	}

	msg := models.Message{
		ConversationID: conversation.ID,
		SenderID:       sender.ID,
		Content:        "sender-owned",
	}
	if err := db.DB.Create(&msg).Error; err != nil {
		t.Fatalf("Failed to create message: %v", err)
	}

	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", receiver.ID)
		c.Next()
	})
	r.DELETE("/conversations/:id/messages/:messageId", deleteMessage)

	req := httptest.NewRequest("DELETE", "/conversations/"+conversation.ID.String()+"/messages/"+msg.ID.String(), nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("Expected status %d, got %d. Body: %s", http.StatusForbidden, w.Code, w.Body.String())
	}
}
