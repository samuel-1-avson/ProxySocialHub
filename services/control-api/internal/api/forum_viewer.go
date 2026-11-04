package api

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// The discussion feed shows a heart that is filled when you liked a post and
// a "solved" mark on answered questions. Both are filled in here for a whole
// page at once (one query each), so a list never costs one query per post.

// decoratedForumThreads projects threads and adds the viewer's own vote and
// whether each thread has an accepted answer.
func decoratedForumThreads(c *gin.Context, threads []models.ForumThread) []forumThreadDTO {
	out := forumThreadDTOs(threads)
	if len(out) == 0 {
		return out
	}
	ids := make([]uuid.UUID, 0, len(out))
	for _, t := range out {
		ids = append(ids, t.ID)
	}

	var solved []uuid.UUID
	if err := db.Social().Model(&models.ForumPost{}).
		Distinct("thread_id").
		Where("thread_id IN ? AND is_solution = ? AND is_hidden = ?", ids, true, false).
		Pluck("thread_id", &solved).Error; err == nil {
		solvedSet := make(map[uuid.UUID]bool, len(solved))
		for _, id := range solved {
			solvedSet[id] = true
		}
		for i := range out {
			out[i].HasSolution = solvedSet[out[i].ID]
		}
	}

	if userID, ok := GetUserID(c); ok {
		var votes []models.ForumVote
		if err := db.Social().
			Where("user_id = ? AND thread_id IN ?", userID, ids).
			Find(&votes).Error; err == nil {
			byThread := make(map[uuid.UUID]int, len(votes))
			for _, v := range votes {
				if v.ThreadID != nil {
					byThread[*v.ThreadID] = v.VoteType
				}
			}
			for i := range out {
				out[i].ViewerVote = byThread[out[i].ID]
			}
		}
	}
	return out
}

// decoratedForumPosts projects replies and adds the viewer's own vote.
func decoratedForumPosts(c *gin.Context, posts []models.ForumPost) []forumPostDTO {
	out := forumPostDTOs(posts)
	userID, ok := GetUserID(c)
	if !ok || len(out) == 0 {
		return out
	}
	ids := make([]uuid.UUID, 0, len(out))
	for _, p := range out {
		ids = append(ids, p.ID)
	}
	var votes []models.ForumVote
	if err := db.Social().
		Where("user_id = ? AND post_id IN ?", userID, ids).
		Find(&votes).Error; err != nil {
		return out
	}
	byPost := make(map[uuid.UUID]int, len(votes))
	for _, v := range votes {
		if v.PostID != nil {
			byPost[*v.PostID] = v.VoteType
		}
	}
	for i := range out {
		out[i].ViewerVote = byPost[out[i].ID]
	}
	return out
}

// forumViewerVote reads the user's current vote on one thread or post after a
// vote toggle: 1, -1, or 0 when the vote was removed. column is "thread_id" or
// "post_id" (never user input).
func forumViewerVote(column string, userID, targetID uuid.UUID) int {
	var vote models.ForumVote
	if err := db.Social().
		Where("user_id = ? AND "+column+" = ?", userID, targetID).
		First(&vote).Error; err != nil {
		return 0
	}
	return vote.VoteType
}
