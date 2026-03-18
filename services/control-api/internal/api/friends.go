package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
)

// ErrorResponse represents a JSON error response
type ErrorResponse struct {
	Error string `json:"error"`
}

// SuccessResponse represents a generic success message
type SuccessResponse struct {
	Message string `json:"message"`
}

// RegisterFriendRoutes registers friendship related endpoints
func RegisterFriendRoutes(r *gin.RouterGroup) {
	f := r.Group("/friends")
	{
		f.POST("/request/:userId", sendFriendRequest)
		f.PUT("/request/:requestId/accept", acceptFriendRequest)
		f.PUT("/request/:requestId/reject", rejectFriendRequest)
		f.GET("/requests", listFriendRequests)
		f.GET("", listFriends)
	}
}

// @Summary      Send friend request
// @Description  Send a friend request to another user
// @Tags         friends
// @Produce      json
// @Param        userId  path      string  true  "Target User ID"
// @Success      200        {object}  SuccessResponse
// @Failure      400     {object}  ErrorResponse
// @Failure      409     {object}  ErrorResponse
// @Router       /friends/request/{userId} [post]
func sendFriendRequest(c *gin.Context) {
	userID, _ := c.Get("userID") // From middleware
	senderID, _ := uuid.Parse(userID.(string))

	targetIDStr := c.Param("userId")
	targetID, err := uuid.Parse(targetIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	if senderID == targetID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot send friend request to yourself"})
		return
	}

	// Check if already friends
	var existingFriendship models.Friendship
	if err := db.Social().Where("user_id = ? AND friend_id = ?", senderID, targetID).First(&existingFriendship).Error; err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "Already friends"})
		return
	}

	// Check for pending request
	var existingReq models.FriendRequest
	if err := db.Social().Where("sender_id = ? AND receiver_id = ? AND status = ?", senderID, targetID, models.FriendRequestPending).First(&existingReq).Error; err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "Friend request already pending"})
		return
	}

	// Check if they sent us a request (inverse) - if so, maybe auto-accept? For now, just block.
	if err := db.Social().Where("sender_id = ? AND receiver_id = ? AND status = ?", targetID, senderID, models.FriendRequestPending).First(&existingReq).Error; err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "They already sent you a request. Accept it instead."})
		return
	}

	req := models.FriendRequest{
		SenderID:   senderID,
		ReceiverID: targetID,
		Status:     models.FriendRequestPending,
	}

	if err := db.Social().Create(&req).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to send request"})
		return
	}

	c.JSON(http.StatusOK, req)
}

// @Summary      Accept friend request
// @Description  Accept a received friend request
// @Tags         friends
// @Produce      json
// @Param        requestId  path      string  true  "Request ID"
// @Success      200        {object}  models.Friendship
// @Failure      404        {object}  ErrorResponse
// @Router       /friends/request/{requestId}/accept [put]
func acceptFriendRequest(c *gin.Context) {
	userID, _ := c.Get("userID")
	receiverID, _ := uuid.Parse(userID.(string))

	reqIDStr := c.Param("requestId")
	reqID, err := uuid.Parse(reqIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request ID"})
		return
	}

	var req models.FriendRequest
	if err := db.Social().First(&req, "id = ?", reqID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Request not found"})
		return
	}

	if req.ReceiverID != receiverID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Not authorized to accept this request"})
		return
	}

	if req.Status != models.FriendRequestPending {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Request is not pending"})
		return
	}

	// Transaction to update request and create friendship(s)
	err = db.Social().Transaction(func(tx *gorm.DB) error {
		// Update Status
		req.Status = models.FriendRequestAccepted
		if err := tx.Save(&req).Error; err != nil {
			return err
		}

		// Create Bidirectional Friendship
		f1 := models.Friendship{UserID: req.SenderID, FriendID: req.ReceiverID}
		f2 := models.Friendship{UserID: req.ReceiverID, FriendID: req.SenderID}

		if err := tx.Create(&f1).Error; err != nil {
			return err
		}
		if err := tx.Create(&f2).Error; err != nil {
			return err
		}
		return nil
	})

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to accept request"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Friend request accepted"})
}

// @Summary      Reject friend request
// @Description  Reject a received friend request
// @Tags         friends
// @Produce      json
// @Param        requestId  path      string  true  "Request ID"
// @Success      200        {object}  SuccessResponse
// @Failure      404        {object}  ErrorResponse
// @Router       /friends/request/{requestId}/reject [put]
func rejectFriendRequest(c *gin.Context) {
	userID, _ := c.Get("userID")
	receiverID, _ := uuid.Parse(userID.(string))

	reqIDStr := c.Param("requestId")
	reqID, err := uuid.Parse(reqIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request ID"})
		return
	}

	var req models.FriendRequest
	if err := db.Social().First(&req, "id = ?", reqID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Request not found"})
		return
	}

	if req.ReceiverID != receiverID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Not authorized to reject this request"})
		return
	}

	req.Status = models.FriendRequestRejected
	if err := db.Social().Save(&req).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to reject request"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Friend request rejected"})
}

// @Summary      List friend requests
// @Description  List incoming and outgoing pending friend requests
// @Tags         friends
// @Produce      json
// @Param        type  query     string  false  "Type: incoming (default) or outgoing"
// @Success      200   {array}   models.FriendRequest
// @Router       /friends/requests [get]
func listFriendRequests(c *gin.Context) {
	userID, _ := c.Get("userID")
	uid, _ := uuid.Parse(userID.(string))

	reqType := c.DefaultQuery("type", "incoming")
	var requests []models.FriendRequest
	var err error

	if reqType == "outgoing" {
		err = db.Social().Where("sender_id = ? AND status = ?", uid, models.FriendRequestPending).
			Preload("Receiver"). // Load user details
			Find(&requests).Error
	} else {
		err = db.Social().Where("receiver_id = ? AND status = ?", uid, models.FriendRequestPending).
			Preload("Sender").
			Find(&requests).Error
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch requests"})
		return
	}

	c.JSON(http.StatusOK, requests)
}

// @Summary      List friends
// @Description  List all friends of the current user
// @Tags         friends
// @Produce      json
// @Success      200   {array}   models.Friendship
// @Router       /friends [get]
func listFriends(c *gin.Context) {
	userID, _ := c.Get("userID")
	uid, _ := uuid.Parse(userID.(string))

	var friends []models.Friendship
	if err := db.Social().Where("user_id = ?", uid).Preload("Friend").Find(&friends).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch friends"})
		return
	}

	c.JSON(http.StatusOK, friends)
}
