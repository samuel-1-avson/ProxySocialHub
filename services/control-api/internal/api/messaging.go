package api

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/privacy"
	"github.com/proxyhubb/control-api/internal/ws"
)

// RegisterMessagingRoutes registers messaging-related routes
func RegisterMessagingRoutes(rg *gin.RouterGroup) {
	rg.GET("/conversations", getConversations)
	rg.GET("/conversations/:id", getConversation)
	rg.POST("/conversations", startConversation)
	rg.GET("/conversations/:id/messages", getMessages)
	rg.POST("/conversations/:id/messages", sendMessage)
	rg.POST("/conversations/:id/read", markAsRead)

	// Enhanced messaging routes
	rg.PUT("/conversations/:id/messages/:messageId", editMessage)
	rg.DELETE("/conversations/:id/messages/:messageId", deleteMessage)
	rg.POST("/messages/:messageId/reactions", addReaction)
	rg.DELETE("/messages/:messageId/reactions/:emoji", removeReaction)
	rg.GET("/conversations/:id/search", searchMessages)
}

// getConversations returns the current user's conversations
func getConversations(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	page := getPageParam(c, 1)
	limit := getLimitParam(c, 20)
	offset := (page - 1) * limit

	var conversations []models.Conversation
	var total int64

	query := db.Social().Model(&models.Conversation{}).
		Where("participant1 = ? OR participant2 = ?", userID, userID)
	query.Count(&total)

	if err := query.Preload("User1").Preload("User2").Preload("Listing").
		Order("last_message_at DESC, id DESC").
		Offset(offset).Limit(limit).
		Find(&conversations).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch conversations"})
		return
	}

	results := buildConversationPreviews(conversations, userID)

	c.JSON(http.StatusOK, gin.H{
		"conversations": results,
		"total":         total,
		"page":          page,
		"limit":         limit,
		"has_more":      int64(page*limit) < total,
	})
}

// getConversation returns one conversation preview for the current user.
// Deep links use it when the target is beyond the loaded list pages (F04).
func getConversation(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	convID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid conversation ID"})
		return
	}

	var conv models.Conversation
	if err := db.Social().Preload("User1").Preload("User2").Preload("Listing").
		First(&conv, "id = ?", convID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Conversation not found"})
		return
	}
	if conv.Participant1 != userID && conv.Participant2 != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	previews := buildConversationPreviews([]models.Conversation{conv}, userID)
	c.JSON(http.StatusOK, previews[0])
}

// buildConversationPreviews attaches last-message, unread-count and
// other-participant data to conversations in two batch queries.
func buildConversationPreviews(conversations []models.Conversation, userID uuid.UUID) []models.ConversationWithPreview {
	results := make([]models.ConversationWithPreview, len(conversations))
	if len(conversations) == 0 {
		return results
	}

	convIDs := make([]uuid.UUID, len(conversations))
	for i, conv := range conversations {
		convIDs[i] = conv.ID
	}

	// Batch last message (1 query) — DISTINCT ON is Postgres-specific; Social DB is Postgres.
	lastByConv := map[uuid.UUID]models.Message{}
	var lastMsgs []models.Message
	if err := db.Social().Raw(`
		SELECT DISTINCT ON (conversation_id) *
		FROM messages
		WHERE conversation_id IN ?
		ORDER BY conversation_id, created_at DESC, id DESC
	`, convIDs).Scan(&lastMsgs).Error; err == nil {
		for _, m := range lastMsgs {
			lastByConv[m.ConversationID] = m
		}
	}

	// Batch unread counts (1 query)
	type unreadRow struct {
		ConversationID uuid.UUID `gorm:"column:conversation_id"`
		Count          int64     `gorm:"column:count"`
	}
	unreadByConv := map[uuid.UUID]int{}
	var unreadRows []unreadRow
	if err := db.Social().Raw(`
		SELECT conversation_id, COUNT(*) AS count
		FROM messages
		WHERE conversation_id IN ?
		  AND sender_id <> ?
		  AND read_at IS NULL
		  AND COALESCE(is_deleted, false) = false
		GROUP BY conversation_id
	`, convIDs, userID).Scan(&unreadRows).Error; err == nil {
		for _, row := range unreadRows {
			unreadByConv[row.ConversationID] = int(row.Count)
		}
	}

	for i, conv := range conversations {
		results[i] = models.ConversationWithPreview{
			Conversation: conv,
			UnreadCount:  unreadByConv[conv.ID],
		}
		if m, ok := lastByConv[conv.ID]; ok {
			msg := m
			results[i].LastMessage = &msg
		}
		if conv.Participant1 == userID {
			results[i].OtherParticipant = conv.User2
		} else {
			results[i].OtherParticipant = conv.User1
		}
	}

	return results
}

// startConversation starts a new conversation or returns existing one
func startConversation(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	var req models.StartConversationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.RecipientID == userID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot start conversation with yourself"})
		return
	}

	// Check recipient exists
	var recipient models.User
	if err := db.DB.First(&recipient, "id = ?", req.RecipientID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	// Check if conversation exists (in either direction)
	var existingConv models.Conversation
	err := db.Social().Where(
		"(participant1 = ? AND participant2 = ?) OR (participant1 = ? AND participant2 = ?)",
		userID, req.RecipientID, req.RecipientID, userID,
	).First(&existingConv).Error

	tx := db.Social().Begin()

	if err == nil {
		// Conversation exists, just send message
		msg := models.Message{
			ConversationID: existingConv.ID,
			SenderID:       userID,
			Content:        req.Message,
		}
		tx.Create(&msg)
		tx.Model(&existingConv).Update("last_message_at", time.Now())
		tx.Commit()

		db.Social().Preload("User1").Preload("User2").First(&existingConv, "id = ?", existingConv.ID)
		c.JSON(http.StatusOK, existingConv)
		return
	}

	// Create new conversation
	conv := models.Conversation{
		Participant1:  userID,
		Participant2:  req.RecipientID,
		ListingID:     req.ListingID,
		LastMessageAt: time.Now(),
	}

	if err := tx.Create(&conv).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create conversation"})
		return
	}

	// Send first message
	msg := models.Message{
		ConversationID: conv.ID,
		SenderID:       userID,
		Content:        req.Message,
	}
	tx.Create(&msg)

	tx.Commit()

	db.Social().Preload("User1").Preload("User2").First(&conv, "id = ?", conv.ID)
	c.JSON(http.StatusCreated, conv)
}

// getMessages returns messages in a conversation
func getMessages(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	convID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid conversation ID"})
		return
	}

	// Verify access
	var conv models.Conversation
	if err := db.Social().First(&conv, "id = ?", convID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Conversation not found"})
		return
	}

	if conv.Participant1 != userID && conv.Participant2 != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	page := getPageParam(c, 1)
	limit := getLimitParam(c, 50)

	var total int64
	if err := db.Social().Model(&models.Message{}).
		Where("conversation_id = ?", convID).Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch messages"})
		return
	}

	// Newest first with an ID tie-breaker so equal timestamps page stably.
	// `before` is a cursor naming the oldest message the client already has;
	// the response continues strictly older than it. Page/offset remains
	// supported when no cursor is supplied.
	listQ := db.Social().Preload("Sender").Preload("Reactions").
		Where("conversation_id = ?", convID)
	cursorMode := false
	if beforeStr := c.Query("before"); beforeStr != "" {
		beforeID, perr := uuid.Parse(beforeStr)
		if perr != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid cursor"})
			return
		}
		var anchor models.Message
		if err := db.Social().First(&anchor, "id = ? AND conversation_id = ?", beforeID, convID).Error; err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid cursor"})
			return
		}
		cursorMode = true
		listQ = listQ.Where("(created_at, id) < (?, ?)", anchor.CreatedAt, anchor.ID)
	}

	var messages []models.Message
	fetch := listQ.Order("created_at DESC, id DESC").Limit(limit + 1)
	if !cursorMode {
		fetch = fetch.Offset((page - 1) * limit)
	}
	if err := fetch.Find(&messages).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch messages"})
		return
	}
	hasMore := len(messages) > limit
	if hasMore {
		messages = messages[:limit]
	}

	c.JSON(http.StatusOK, gin.H{
		"messages": messages,
		"total":    total,
		"page":     page,
		"limit":    limit,
		"has_more": hasMore,
	})
}

// sendMessage sends a message in a conversation
func sendMessage(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	convID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid conversation ID"})
		return
	}

	var req struct {
		Content   string     `json:"content" binding:"required"`
		ReplyToID *uuid.UUID `json:"reply_to_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Verify access
	var conv models.Conversation
	if err := db.Social().First(&conv, "id = ?", convID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Conversation not found"})
		return
	}

	if conv.Participant1 != userID && conv.Participant2 != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	if req.ReplyToID != nil {
		var count int64
		if err := db.Social().Model(&models.Message{}).
			Where("id = ? AND conversation_id = ?", *req.ReplyToID, convID).
			Count(&count).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to validate reply target"})
			return
		}
		if count == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Reply target is not in this conversation"})
			return
		}
	}

	// Apply Privacy Shield (Phase 15)
	safeContent := privacy.MaskPII(req.Content)

	msg := models.Message{
		ConversationID: convID,
		SenderID:       userID,
		Content:        safeContent,
		ReplyToID:      req.ReplyToID,
	}

	tx := db.Social().Begin()
	tx.Create(&msg)
	tx.Model(&conv).Update("last_message_at", time.Now())
	tx.Commit()

	db.Social().Preload("Sender").First(&msg, "id = ?", msg.ID)

	// Broadcast to recipient via WebSocket
	recipientID := conv.Participant1
	if recipientID == userID {
		recipientID = conv.Participant2
	}
	ws.BroadcastToUser(recipientID.String(), ws.MsgTypeNewMessage, gin.H{
		"conversation_id": convID,
		"message":         msg,
	})
	dispatchUserNotification(c.Request.Context(), userNotification{
		UserID:     recipientID,
		Type:       models.NotificationMessage,
		Title:      "New message",
		Body:       truncate(safeContent, 160),
		ActionURL:  "/messages?conversation=" + convID.String(),
		ActionType: "open_conversation",
		ActorID:    &userID,
		TargetType: "conversation",
		TargetID:   &convID,
		Dedupe:     true,
	})

	c.JSON(http.StatusCreated, msg)
}

// markAsRead marks all messages as read
func markAsRead(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	convID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid conversation ID"})
		return
	}

	// Verify access
	var conv models.Conversation
	if err := db.Social().First(&conv, "id = ?", convID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Conversation not found"})
		return
	}

	if conv.Participant1 != userID && conv.Participant2 != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	// Optional read watermark: only messages at or before the named one are
	// marked, so arrivals the reader has not seen yet stay unread. Without a
	// body the legacy mark-everything behavior applies.
	var req struct {
		UpToMessageID *uuid.UUID `json:"up_to_message_id"`
	}
	if c.Request.ContentLength > 0 {
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
	}

	update := db.Social().Model(&models.Message{}).
		Where("conversation_id = ? AND sender_id != ? AND read_at IS NULL", convID, userID)
	if req.UpToMessageID != nil {
		var anchor models.Message
		if err := db.Social().First(&anchor, "id = ? AND conversation_id = ?", *req.UpToMessageID, convID).Error; err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "up_to_message_id is not in this conversation"})
			return
		}
		update = update.Where("(created_at, id) <= (?, ?)", anchor.CreatedAt, anchor.ID)
	}

	if err := update.Update("read_at", time.Now()).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to mark messages as read"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Messages marked as read"})
}

// editMessage allows editing a message within 5 minutes
func editMessage(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	convID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid conversation ID"})
		return
	}

	msgID, err := uuid.Parse(c.Param("messageId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid message ID"})
		return
	}

	var req struct {
		Content string `json:"content" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Verify message exists and belongs to user
	var msg models.Message
	if err := db.Social().First(&msg, "id = ? AND conversation_id = ?", msgID, convID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Message not found"})
		return
	}

	if msg.SenderID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Can only edit your own messages"})
		return
	}

	// Check edit window (5 minutes)
	if time.Since(msg.CreatedAt) > 5*time.Minute {
		c.JSON(http.StatusForbidden, gin.H{"error": "Edit window expired"})
		return
	}

	now := time.Now()
	updates := map[string]interface{}{
		"content":   privacy.MaskPII(req.Content),
		"edited_at": now,
	}

	if err := db.Social().Model(&msg).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	db.Social().Preload("Sender").First(&msg, "id = ?", msg.ID)
	c.JSON(http.StatusOK, msg)
}

// deleteMessage soft-deletes a message
func deleteMessage(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	convID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid conversation ID"})
		return
	}

	msgID, err := uuid.Parse(c.Param("messageId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid message ID"})
		return
	}

	// Verify message exists
	var msg models.Message
	if err := db.Social().First(&msg, "id = ? AND conversation_id = ?", msgID, convID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Message not found"})
		return
	}

	// Only the sender can delete their own message. Conversation-level
	// moderation should use an explicit admin/moderator path.
	var conv models.Conversation
	if err := db.Social().First(&conv, "id = ?", convID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Conversation not found"})
		return
	}

	if conv.Participant1 != userID && conv.Participant2 != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}
	if msg.SenderID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Can only delete your own messages"})
		return
	}

	if err := db.Social().Model(&msg).Update("is_deleted", true).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Message deleted"})
}

// addReaction adds a reaction to a message
func addReaction(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	msgID, err := uuid.Parse(c.Param("messageId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid message ID"})
		return
	}

	var req struct {
		Emoji string `json:"emoji" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Verify message exists
	var msg models.Message
	if err := db.Social().First(&msg, "id = ?", msgID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Message not found"})
		return
	}

	if !userCanAccessMessage(userID, msg) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	reaction := models.MessageReaction{
		MessageID: msgID,
		UserID:    userID,
		Emoji:     req.Emoji,
		CreatedAt: time.Now(),
	}

	// Upsert reaction
	if err := db.Social().Save(&reaction).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, reaction)
}

// removeReaction removes a reaction from a message
func removeReaction(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	msgID, err := uuid.Parse(c.Param("messageId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid message ID"})
		return
	}

	emoji := c.Param("emoji")

	var msg models.Message
	if err := db.Social().First(&msg, "id = ?", msgID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Message not found"})
		return
	}
	if !userCanAccessMessage(userID, msg) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	result := db.Social().Where("message_id = ? AND user_id = ? AND emoji = ?", msgID, userID, emoji).
		Delete(&models.MessageReaction{})

	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Reaction removed"})
}

// searchMessages searches messages in a conversation
func searchMessages(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	convID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid conversation ID"})
		return
	}

	// Verify access
	var conv models.Conversation
	if err := db.Social().First(&conv, "id = ?", convID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Conversation not found"})
		return
	}

	if conv.Participant1 != userID && conv.Participant2 != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	query := c.Query("q")
	if query == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Query required"})
		return
	}

	var messages []models.Message
	db.Social().Where("conversation_id = ? AND content ILIKE ? AND is_deleted = ?",
		convID, "%"+query+"%", false).
		Order("created_at DESC").
		Limit(50).
		Preload("Sender").
		Find(&messages)

	c.JSON(http.StatusOK, gin.H{
		"messages": messages,
		"query":    query,
	})
}

func userCanAccessMessage(userID uuid.UUID, msg models.Message) bool {
	var conv models.Conversation
	if err := db.Social().First(&conv, "id = ?", msg.ConversationID).Error; err != nil {
		return false
	}
	return conv.Participant1 == userID || conv.Participant2 == userID
}
