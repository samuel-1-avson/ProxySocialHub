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
