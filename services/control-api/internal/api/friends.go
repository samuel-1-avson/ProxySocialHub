package api

import (
	"net/http"
	"time"

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
		f.DELETE("/request/:requestId", cancelFriendRequest)
		f.GET("/requests", listFriendRequests)
		f.GET("/status/:userId", getFriendshipStatus)
		f.DELETE("/:friendId", removeFriend)
		f.GET("", listFriends)
	}

	r.GET("/discover/people", getPeopleYouMayKnow)
	r.GET("/users/:id/mutual-friends", getMutualFriends)
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
	senderID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

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

	if rejectIfBlocked(c, senderID, targetID) {
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

	dispatchUserNotification(c.Request.Context(), userNotification{
		UserID:     targetID,
		Type:       models.NotificationNewFriendRequest,
		Title:      "New friend request",
		Body:       "Someone sent you a friend request",
		ActionURL:  "/friends",
		ActionType: "open_friends",
		ActorID:    &senderID,
		TargetType: "friend_request",
		TargetID:   &req.ID,
		Dedupe:     true,
	})

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
	receiverID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

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

	if rejectIfBlocked(c, receiverID, req.SenderID) {
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

	dispatchUserNotification(c.Request.Context(), userNotification{
		UserID:     req.SenderID,
		Type:       models.NotificationFriendAccepted,
		Title:      "Friend request accepted",
		Body:       "Your friend request was accepted",
		ActionURL:  "/friends",
		ActionType: "open_friends",
		ActorID:    &receiverID,
		TargetType: "friend_request",
		TargetID:   &req.ID,
		Dedupe:     true,
	})

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
	receiverID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

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

// cancelFriendRequest cancels an outgoing pending friend request.
func cancelFriendRequest(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	reqID, err := uuid.Parse(c.Param("requestId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request ID"})
		return
	}

	var req models.FriendRequest
	if err := db.Social().First(&req, "id = ?", reqID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Request not found"})
		return
	}
	if req.SenderID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Can only cancel your own outgoing requests"})
		return
	}
	if req.Status != models.FriendRequestPending {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Request is not pending"})
		return
	}

	if err := db.Social().Delete(&req).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to cancel request"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Friend request canceled"})
}

// @Summary      List friend requests
// @Description  List incoming and outgoing pending friend requests
// @Tags         friends
// @Produce      json
// @Param        type  query     string  false  "Type: incoming (default) or outgoing"
// @Success      200   {array}   models.FriendRequest
// @Router       /friends/requests [get]
func listFriendRequests(c *gin.Context) {
	uid, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

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

// getFriendshipStatus returns the relationship state between the current user and a target user.
func getFriendshipStatus(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	targetID, err := uuid.Parse(c.Param("userId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}
	if targetID == userID {
		c.JSON(http.StatusOK, gin.H{"status": "none"})
		return
	}

	var targetCount int64
	if err := db.Social().Model(&models.User{}).Where("id = ?", targetID).Count(&targetCount).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch user"})
		return
	}
	if targetCount == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	var friendship models.Friendship
	if err := db.Social().Where("user_id = ? AND friend_id = ?", userID, targetID).First(&friendship).Error; err == nil {
		c.JSON(http.StatusOK, gin.H{"status": "friends"})
		return
	}

	var outgoing models.FriendRequest
	if err := db.Social().
		Where("sender_id = ? AND receiver_id = ? AND status = ?", userID, targetID, models.FriendRequestPending).
		First(&outgoing).Error; err == nil {
		c.JSON(http.StatusOK, gin.H{"status": "request_sent", "request_id": outgoing.ID})
		return
	}

	var incoming models.FriendRequest
	if err := db.Social().
		Where("sender_id = ? AND receiver_id = ? AND status = ?", targetID, userID, models.FriendRequestPending).
		First(&incoming).Error; err == nil {
		c.JSON(http.StatusOK, gin.H{"status": "request_received", "request_id": incoming.ID})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "none"})
}

// removeFriend removes an established bidirectional friendship.
func removeFriend(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	friendID, err := uuid.Parse(c.Param("friendId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid friend ID"})
		return
	}
	if friendID == userID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot remove yourself as a friend"})
		return
	}

	result := db.Social().Where(
		"(user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)",
		userID, friendID, friendID, userID,
	).Delete(&models.Friendship{})
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to remove friend"})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Friendship not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Friend removed"})
}

// @Summary      List friends
// @Description  List all friends of the current user
// @Tags         friends
// @Produce      json
// @Success      200   {array}   models.Friendship
// @Router       /friends [get]
func listFriends(c *gin.Context) {
	uid, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	var friends []models.Friendship
	if err := db.Social().Where("user_id = ?", uid).Preload("Friend").Find(&friends).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch friends"})
		return
	}

	c.JSON(http.StatusOK, friends)
}

type friendUserSummary struct {
	ID          uuid.UUID  `json:"id"`
	Username    string     `json:"username"`
	DisplayName *string    `json:"display_name,omitempty"`
	AvatarURL   *string    `json:"avatar_url,omitempty"`
	Bio         *string    `json:"bio,omitempty"`
	IsOnline    bool       `json:"is_online"`
	LastSeenAt  *time.Time `json:"last_seen_at,omitempty"`
}

type suggestedUserResponse struct {
	friendUserSummary
	Reason      string `json:"reason"`
	Score       int64  `json:"score"`
	MutualCount int64  `json:"mutual_count,omitempty"`
	IsFollowing bool   `json:"is_following"`
}

func summarizeFriendUser(user models.User) friendUserSummary {
	username := user.ID.String()
	if user.Username != nil && *user.Username != "" {
		username = *user.Username
	}

	return friendUserSummary{
		ID:          user.ID,
		Username:    username,
		DisplayName: user.DisplayName,
		AvatarURL:   user.AvatarURL,
		Bio:         user.Bio,
		IsOnline:    user.IsOnline,
		LastSeenAt:  user.LastSeenAt,
	}
}

// getPeopleYouMayKnow returns friend suggestions excluding current friends and pending requests.
func getPeopleYouMayKnow(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	limit := getLimitParam(c, 10)
	excluded := []uuid.UUID{userID}

	var friendships []models.Friendship
	if err := db.Social().Where("user_id = ?", userID).Find(&friendships).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load friends"})
		return
	}
	for _, friendship := range friendships {
		excluded = append(excluded, friendship.FriendID)
	}

	var pending []models.FriendRequest
	if err := db.Social().
		Where("(sender_id = ? OR receiver_id = ?) AND status = ?", userID, userID, models.FriendRequestPending).
		Find(&pending).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load pending requests"})
		return
	}
	for _, req := range pending {
		if req.SenderID == userID {
			excluded = append(excluded, req.ReceiverID)
		} else {
			excluded = append(excluded, req.SenderID)
		}
	}

	blockedIDs, err := blockedCounterpartyIDs(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load blocked users"})
		return
	}
	excluded = append(excluded, blockedIDs...)

	var users []models.User
	if err := db.Social().
		Where("id NOT IN ?", excluded).
		Where("status NOT IN ?", []models.UserStatus{models.UserStatusSuspended, models.UserStatusBanned}).
		Order("followers_count DESC, created_at DESC").
		Limit(limit).
		Find(&users).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch suggestions"})
		return
	}

	suggestions := make([]suggestedUserResponse, 0, len(users))
	myFriends := db.Social().Model(&models.Friendship{}).Select("friend_id").Where("user_id = ?", userID)
	for _, user := range users {
		var mutualCount int64
		db.Social().Model(&models.Friendship{}).
			Where("user_id = ? AND friend_id IN (?)", user.ID, myFriends).
			Count(&mutualCount)

		reason := "suggested"
		if mutualCount > 0 {
			reason = "mutual_friends"
		}

		suggestions = append(suggestions, suggestedUserResponse{
			friendUserSummary: summarizeFriendUser(user),
			Reason:            reason,
			Score:             mutualCount,
			MutualCount:       mutualCount,
			IsFollowing:       false,
		})
	}

	c.JSON(http.StatusOK, gin.H{"suggestions": suggestions})
}

// getMutualFriends returns friends shared by the current user and target user.
func getMutualFriends(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	targetID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	targetFriends := db.Social().Model(&models.Friendship{}).Select("friend_id").Where("user_id = ?", targetID)
	var mutual []models.Friendship
	if err := db.Social().
		Where("user_id = ? AND friend_id IN (?)", userID, targetFriends).
		Preload("Friend").
		Find(&mutual).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch mutual friends"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"friends": mutual, "count": len(mutual)})
}
