package api

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/privacy"
)

// RegisterMessagingRoutes registers messaging-related routes
func RegisterMessagingRoutes(rg *gin.RouterGroup) {
	rg.GET("/conversations", getConversations)
	rg.POST("/conversations", startConversation)
	rg.GET("/conversations/:id/messages", getMessages)
	rg.POST("/conversations/:id/messages", sendMessage)
	rg.POST("/conversations/:id/read", markAsRead)
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

	query := db.DB.Model(&models.Conversation{}).
		Where("participant1 = ? OR participant2 = ?", userID, userID)
	query.Count(&total)

	if err := query.Preload("User1").Preload("User2").Preload("Listing").
		Order("last_message_at DESC").
		Offset(offset).Limit(limit).
		Find(&conversations).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch conversations"})
		return
	}

	// Build response with previews
	results := make([]models.ConversationWithPreview, len(conversations))
	for i, conv := range conversations {
		results[i] = models.ConversationWithPreview{
			Conversation: conv,
		}

		// Get last message
		var lastMsg models.Message
		if err := db.DB.Where("conversation_id = ?", conv.ID).
			Order("created_at DESC").First(&lastMsg).Error; err == nil {
			results[i].LastMessage = &lastMsg
		}

		// Get unread count
		var unreadCount int64
		db.DB.Model(&models.Message{}).
			Where("conversation_id = ? AND sender_id != ? AND read_at IS NULL", conv.ID, userID).
			Count(&unreadCount)
		results[i].UnreadCount = int(unreadCount)

		// Get other participant
		if conv.Participant1 == userID {
			results[i].OtherParticipant = conv.User2
		} else {
			results[i].OtherParticipant = conv.User1
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"conversations": results,
		"total":         total,
		"page":          page,
		"limit":         limit,
	})
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
	err := db.DB.Where(
		"(participant1 = ? AND participant2 = ?) OR (participant1 = ? AND participant2 = ?)",
		userID, req.RecipientID, req.RecipientID, userID,
	).First(&existingConv).Error

	tx := db.DB.Begin()

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

		db.DB.Preload("User1").Preload("User2").First(&existingConv, "id = ?", existingConv.ID)
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

	db.DB.Preload("User1").Preload("User2").First(&conv, "id = ?", conv.ID)
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
	if err := db.DB.First(&conv, "id = ?", convID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Conversation not found"})
		return
	}

	if conv.Participant1 != userID && conv.Participant2 != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	page := getPageParam(c, 1)
	limit := getLimitParam(c, 50)
	offset := (page - 1) * limit

	var messages []models.Message
	var total int64

	query := db.DB.Model(&models.Message{}).Where("conversation_id = ?", convID)
	query.Count(&total)

	if err := query.Preload("Sender").
		Order("created_at DESC").
		Offset(offset).Limit(limit).
		Find(&messages).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch messages"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"messages": messages,
		"total":    total,
		"page":     page,
		"limit":    limit,
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

	var req models.SendMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Verify access
	var conv models.Conversation
	if err := db.DB.First(&conv, "id = ?", convID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Conversation not found"})
		return
	}

	if conv.Participant1 != userID && conv.Participant2 != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	// Apply Privacy Shield (Phase 15)
	safeContent := privacy.MaskPII(req.Content)

	msg := models.Message{
		ConversationID: convID,
		SenderID:       userID,
		Content:        safeContent,
	}

	tx := db.DB.Begin()
	tx.Create(&msg)
	tx.Model(&conv).Update("last_message_at", time.Now())
	tx.Commit()

	db.DB.Preload("Sender").First(&msg, "id = ?", msg.ID)

	// Broadcast to recipient via WebSocket
	recipientID := conv.Participant1
	if recipientID == userID {
		recipientID = conv.Participant2
	}
	BroadcastToUser(recipientID.String(), MsgTypeNewMessage, gin.H{
		"conversation_id": convID,
		"message":         msg,
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
	if err := db.DB.First(&conv, "id = ?", convID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Conversation not found"})
		return
	}

	if conv.Participant1 != userID && conv.Participant2 != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	now := time.Now()
	db.DB.Model(&models.Message{}).
		Where("conversation_id = ? AND sender_id != ? AND read_at IS NULL", convID, userID).
		Update("read_at", now)

	c.JSON(http.StatusOK, gin.H{"message": "Messages marked as read"})
}
