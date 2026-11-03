package api

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
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
	r.POST("/discover/people/:userId/dismiss", dismissSuggestion)
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

	var target models.User
	if db.DB.First(&target, "id = ?", targetID).Error != nil || target.ContactMode == "nobody" {
		c.JSON(403, gin.H{"error": "Contact requests unavailable"})
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

	c.JSON(http.StatusOK, friendRequestDTOFrom(req))
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

	c.JSON(http.StatusOK, friendRequestDTOs(requests))
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

	c.JSON(http.StatusOK, friendshipDTOs(friends))
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
	public := user.ToPublicProfile()
	username := user.ID.String()
	if user.Username != nil && *user.Username != "" {
		username = *user.Username
	}

	return friendUserSummary{
		ID:          user.ID,
		Username:    username,
		DisplayName: public.DisplayName,
		AvatarURL:   public.AvatarURL,
		Bio:         public.Bio,
		IsOnline:    public.IsOnline,
		LastSeenAt:  public.LastSeenAt,
	}
}

// getPeopleYouMayKnow returns friend suggestions ranked by evidence the UI
// can honestly state (F10): mutual-friend count first, then account
// newness — never raw popularity. Mutual counts are computed in the query
// (no per-candidate loop), exclusions are subqueries (friends, pending
// requests, dismissed suggestions, blocked counterparties, suspended or
// banned accounts), and results are paginated.
func getPeopleYouMayKnow(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	page := getPageParam(c, 1)
	limit := getLimitParam(c, 10)

	blockedIDs, err := blockedCounterpartyIDs(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load blocked users"})
		return
	}

	// Consent and discovery exclusions must use the primary database.
	social := db.DB
	friendsSub := social.Model(&models.Friendship{}).Select("friend_id").Where("user_id = ?", userID)
	pendingOutSub := social.Model(&models.FriendRequest{}).Select("receiver_id").
		Where("sender_id = ? AND status = ?", userID, models.FriendRequestPending)
	pendingInSub := social.Model(&models.FriendRequest{}).Select("sender_id").
		Where("receiver_id = ? AND status = ?", userID, models.FriendRequestPending)
	dismissedSub := social.Model(&models.SuggestionDismissal{}).Select("dismissed_user_id").
		Where("user_id = ?", userID)

	eligible := func(q *gorm.DB) *gorm.DB {
		q = q.Where("p.id <> ?", userID).
			Where("p.profile_public = ? AND p.discoverable = ?", true, true).
			Where("p.status NOT IN ?", []models.UserStatus{models.UserStatusSuspended, models.UserStatusBanned}).
			Where("p.id NOT IN (?)", friendsSub).
			Where("p.id NOT IN (?)", pendingOutSub).
			Where("p.id NOT IN (?)", pendingInSub).
			Where("p.id NOT IN (?)", dismissedSub)
		if len(blockedIDs) > 0 {
			q = q.Where("p.id NOT IN ?", blockedIDs)
		}
		return q
	}

	var total int64
	if err := eligible(social.Table("profiles AS p")).Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch suggestions"})
		return
	}

	type suggestionRow struct {
		models.User
		MutualCount int64 `gorm:"column:mutual_count"`
		IsFollowing bool  `gorm:"column:is_following"`
	}
	var rows []suggestionRow
	listQ := eligible(social.Table("profiles AS p")).
		Select(`p.*, COALESCE(m.mutual_count, 0) AS mutual_count,
			EXISTS (SELECT 1 FROM follows WHERE follower_id = ? AND following_id = p.id) AS is_following`, userID).
		Joins(`LEFT JOIN (
			SELECT f2.user_id AS candidate_id, COUNT(*) AS mutual_count
			FROM friendships f1
			JOIN friendships f2 ON f2.friend_id = f1.friend_id
			WHERE f1.user_id = ?
			GROUP BY f2.user_id
		) m ON m.candidate_id = p.id`, userID).
		Order("mutual_count DESC, p.created_at DESC, p.id DESC").
		Offset((page - 1) * limit).Limit(limit)
	if err := listQ.Scan(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch suggestions"})
		return
	}

	suggestions := make([]suggestedUserResponse, 0, len(rows))
	for _, row := range rows {
		reason := "new_member"
		if row.MutualCount > 0 {
			reason = "mutual_friends"
		}
		suggestions = append(suggestions, suggestedUserResponse{
			friendUserSummary: summarizeFriendUser(row.User),
			Reason:            reason,
			Score:             row.MutualCount,
			MutualCount:       row.MutualCount,
			IsFollowing:       row.IsFollowing,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"suggestions": suggestions,
		"total":       total,
		"page":        page,
		"limit":       limit,
		"has_more":    int64(page*limit) < total,
	})
}

// dismissSuggestion persists a people-suggestion dismissal (F10) so the
// person is not suggested again on any device. Idempotent.
func dismissSuggestion(c *gin.Context) {
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
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot dismiss yourself"})
		return
	}

	var target models.User
	if err := db.Social().First(&target, "id = ?", targetID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	dismissal := models.SuggestionDismissal{UserID: userID, DismissedUserID: targetID}
	if err := db.Social().Clauses(clause.OnConflict{DoNothing: true}).Create(&dismissal).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to dismiss suggestion"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"dismissed": true})
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

	c.JSON(http.StatusOK, gin.H{"friends": friendshipDTOs(mutual), "count": len(mutual)})
}
