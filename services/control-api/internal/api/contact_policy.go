package api

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
)

func allowProfileGraph(c *gin.Context, subject uuid.UUID) bool {
	c.Header("Cache-Control", "no-store")
	viewer, _ := GetUserID(c)
	if viewer == subject {
		return true
	}
	var u models.User
	if db.DB.First(&u, "id = ?", subject).Error != nil || !u.ProfilePublic {
		c.JSON(404, gin.H{"error": "Profile unavailable"})
		return false
	}
	if viewer != uuid.Nil && rejectIfBlocked(c, viewer, subject) {
		return false
	}
	return true
}

// Shared block/contact policy (F02). Every social-contact entry point —
// starting a conversation, sending a message, sending or accepting a
// friend request, following and people suggestions — goes through these
// helpers so a block means the same thing everywhere: no new contact in
// either direction, while existing conversation history stays readable.

// findBlockBetween returns the block row if either user blocks the other.
func findBlockBetween(a, b uuid.UUID) (*models.Block, error) {
	var block models.Block
	err := db.Social().Where(
		"(blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)",
		a, b, b, a,
	).First(&block).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &block, nil
}

func blockedBetween(a, b uuid.UUID) (bool, error) {
	block, err := findBlockBetween(a, b)
	return block != nil, err
}

// Everyone permits new contact, contacts requires friendship, inquiries also
// permits an explicit listing inquiry. A prior reply consents to that existing
// conversation only. Nobody and blocks always stop further contact.
func contactAllowed(a, b uuid.UUID, listingID, conversationID *uuid.UUID) (bool, error) {
	blocked, err := blockedBetween(a, b)
	if err != nil || blocked {
		return false, err
	}
	var target struct {
		ContactMode string
		Status      string
	}
	if err = db.DB.Table("profiles").Select("contact_mode,status").Where("id = ?", b).Take(&target).Error; err != nil {
		return false, err
	}
	if target.Status != "active" && target.Status != "pending" || target.ContactMode == "nobody" {
		return false, nil
	}
	if target.ContactMode == "everyone" {
		return true, nil
	}
	var n int64
	if err = db.Social().Table("friendships").Where("user_id = ? AND friend_id = ?", a, b).Count(&n).Error; err != nil {
		return false, err
	}
	if n > 0 {
		return true, nil
	}
	if conversationID != nil {
		if err = db.Social().Model(&models.Message{}).Where("conversation_id = ? AND sender_id = ?", *conversationID, b).Count(&n).Error; err != nil {
			return false, err
		}
		if n > 0 {
			return true, nil
		}
	}
	if target.ContactMode == "inquiries" && listingID != nil {
		err = db.DB.Model(&models.ProxyListing{}).Where("id = ? AND seller_id = ? AND status = ? AND allow_direct_message = ?", *listingID, b, models.ListingStatusActive, true).Count(&n).Error
		return n > 0, err
	}
	return false, nil
}

func rejectContact(c *gin.Context, a, b uuid.UUID, listingID, conversationID *uuid.UUID) bool {
	ok, err := contactAllowed(a, b, listingID, conversationID)
	if err != nil {
		c.JSON(503, gin.H{"error": "Contact preferences unavailable"})
		return true
	}
	if !ok {
		c.JSON(403, gin.H{"error": "This account is not accepting this contact"})
		return true
	}
	return false
}

// rejectIfBlocked writes a generic 403 (never revealing which party
// blocked) or a 500 on lookup failure, and reports whether the caller
// must stop. It fails closed: a policy lookup error is never treated as
// "not blocked".
func rejectIfBlocked(c *gin.Context, a, b uuid.UUID) bool {
	blocked, err := blockedBetween(a, b)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to check contact policy"})
		return true
	}
	if blocked {
		c.JSON(http.StatusForbidden, gin.H{"error": "Cannot contact this user"})
		return true
	}
	return false
}

// blockedCounterpartyIDs lists every user with a block relationship to
// userID in either direction, for suggestion/recommendation exclusion.
func blockedCounterpartyIDs(userID uuid.UUID) ([]uuid.UUID, error) {
	var blocks []models.Block
	if err := db.Social().
		Where("blocker_id = ? OR blocked_id = ?", userID, userID).
		Find(&blocks).Error; err != nil {
		return nil, err
	}
	ids := make([]uuid.UUID, 0, len(blocks))
	for _, block := range blocks {
		if block.BlockerID == userID {
			ids = append(ids, block.BlockedID)
		} else {
			ids = append(ids, block.BlockerID)
		}
	}
	return ids, nil
}
