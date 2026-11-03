package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

// F10: suggestions are ranked by evidence the UI can state (mutual friends
// first, then newest members — never raw popularity), computed without a
// per-candidate query loop, paginated, and dismissals persist server-side.

type f10SuggestionsResponse struct {
	Suggestions []struct {
		ID          uuid.UUID `json:"id"`
		Reason      string    `json:"reason"`
		MutualCount int64     `json:"mutual_count"`
		IsFollowing bool      `json:"is_following"`
	} `json:"suggestions"`
	Total   int64 `json:"total"`
	Page    int   `json:"page"`
	HasMore bool  `json:"has_more"`
}

func f10GetSuggestions(t *testing.T, viewer uuid.UUID, query string) f10SuggestionsResponse {
	t.Helper()
	r := setupTestRouter()
	r.Use(func(c *gin.Context) { c.Set("user_id", viewer); c.Next() })
	r.GET("/discover/people", getPeopleYouMayKnow)
	req := httptest.NewRequest("GET", "/discover/people"+query, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("GET suggestions%s: expected 200, got %d. Body: %s", query, w.Code, w.Body.String())
	}
	var resp f10SuggestionsResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return resp
}

func f10PinProfile(t *testing.T, userID uuid.UUID, followers int, createdAt time.Time) {
	t.Helper()
	if err := db.DB.Exec(
		`UPDATE profiles SET followers_count = ?, created_at = ? WHERE id = ?`,
		followers, createdAt, userID,
	).Error; err != nil {
		t.Fatalf("pin profile: %v", err)
	}
}

func TestF10SuggestionsRankMutualsBeforePopularity(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "friendships", "friend_requests", "follows", "suggestion_dismissals")

	viewer := testutil.CreateTestUser(t, testutil.UniqueEmail("f10viewer"), "buyer")
	friendA := testutil.CreateTestUser(t, testutil.UniqueEmail("f10frienda"), "buyer")
	friendB := testutil.CreateTestUser(t, testutil.UniqueEmail("f10friendb"), "buyer")
	mutualRich := testutil.CreateTestUser(t, testutil.UniqueEmail("f10mutual"), "provider")
	popular := testutil.CreateTestUser(t, testutil.UniqueEmail("f10popular"), "provider")
	newer := testutil.CreateTestUser(t, testutil.UniqueEmail("f10newer"), "provider")

	base := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	f10PinProfile(t, mutualRich.ID, 0, base)                   // oldest, unknown, 2 mutuals
	f10PinProfile(t, popular.ID, 9999, base.Add(24*time.Hour)) // hugely popular, no mutuals
	f10PinProfile(t, newer.ID, 0, base.Add(48*time.Hour))      // newest, no mutuals

	befriend := func(a, b *models.User) {
		t.Helper()
		if err := db.DB.Create(&models.Friendship{UserID: a.ID, FriendID: b.ID}).Error; err != nil {
			t.Fatalf("friendship: %v", err)
		}
	}
	befriend(viewer, friendA)
	befriend(viewer, friendB)
	befriend(mutualRich, friendA)
	befriend(mutualRich, friendB)

	// Viewer already follows the popular account (follow != friendship).
	if err := db.DB.Create(&models.Follow{FollowerID: viewer.ID, FollowingID: popular.ID}).Error; err != nil {
		t.Fatalf("follow: %v", err)
	}

	resp := f10GetSuggestions(t, viewer.ID, "")
	if len(resp.Suggestions) != 3 {
		t.Fatalf("expected 3 suggestions, got %d (%+v)", len(resp.Suggestions), resp.Suggestions)
	}
	if resp.Suggestions[0].ID != mutualRich.ID {
		t.Fatalf("mutual-rich candidate must rank first, got order %v", []uuid.UUID{resp.Suggestions[0].ID, resp.Suggestions[1].ID, resp.Suggestions[2].ID})
	}
	if resp.Suggestions[0].Reason != "mutual_friends" || resp.Suggestions[0].MutualCount != 2 {
		t.Fatalf("expected mutual_friends x2 evidence, got %+v", resp.Suggestions[0])
	}
	if resp.Suggestions[1].ID != newer.ID || resp.Suggestions[2].ID != popular.ID {
		t.Fatalf("non-mutual candidates must order newest first (not by followers), got %v then %v", resp.Suggestions[1].ID, resp.Suggestions[2].ID)
	}
	if resp.Suggestions[1].Reason != "new_member" || resp.Suggestions[2].Reason != "new_member" {
		t.Fatalf("expected honest new_member reasons, got %q/%q", resp.Suggestions[1].Reason, resp.Suggestions[2].Reason)
	}
	if !resp.Suggestions[2].IsFollowing {
		t.Fatalf("expected is_following=true for the followed candidate")
	}
	if resp.Total != 3 {
		t.Fatalf("expected total 3, got %d", resp.Total)
	}
}

func TestF10SuggestionsPaginate(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "friendships", "friend_requests", "follows", "suggestion_dismissals")

	viewer := testutil.CreateTestUser(t, testutil.UniqueEmail("f10pageviewer"), "buyer")
	base := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	for i := 0; i < 25; i++ {
		candidate := testutil.CreateTestUser(t, testutil.UniqueEmail(fmt.Sprintf("f10cand%02d", i)), "provider")
		f10PinProfile(t, candidate.ID, 0, base.Add(time.Duration(i)*time.Hour))
	}

	first := f10GetSuggestions(t, viewer.ID, "?page=1&limit=20")
	second := f10GetSuggestions(t, viewer.ID, "?page=2&limit=20")
	if len(first.Suggestions) != 20 || len(second.Suggestions) != 5 {
		t.Fatalf("expected 20+5, got %d+%d", len(first.Suggestions), len(second.Suggestions))
	}
	if !first.HasMore || second.HasMore || first.Total != 25 {
		t.Fatalf("bad paging metadata: total=%d has_more=%v/%v", first.Total, first.HasMore, second.HasMore)
	}
	seen := map[uuid.UUID]bool{}
	for _, s := range append(first.Suggestions, second.Suggestions...) {
		if seen[s.ID] {
			t.Fatalf("duplicate suggestion across pages: %s", s.ID)
		}
		seen[s.ID] = true
	}
}

func TestF10DismissalPersistsAndIsIdempotent(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "friendships", "friend_requests", "follows", "suggestion_dismissals")

	viewer := testutil.CreateTestUser(t, testutil.UniqueEmail("f10dismissviewer"), "buyer")
	candidate := testutil.CreateTestUser(t, testutil.UniqueEmail("f10dismissed"), "provider")
	kept := testutil.CreateTestUser(t, testutil.UniqueEmail("f10kept"), "provider")

	dismiss := func(target uuid.UUID) *httptest.ResponseRecorder {
		r := setupTestRouter()
		r.Use(func(c *gin.Context) { c.Set("user_id", viewer.ID); c.Next() })
		r.POST("/discover/people/:userId/dismiss", dismissSuggestion)
		req := httptest.NewRequest("POST", "/discover/people/"+target.String()+"/dismiss", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}

	if w := dismiss(candidate.ID); w.Code != http.StatusOK {
		t.Fatalf("dismiss: expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
	if w := dismiss(candidate.ID); w.Code != http.StatusOK {
		t.Fatalf("dismiss replay must be idempotent 200, got %d. Body: %s", w.Code, w.Body.String())
	}
	if w := dismiss(viewer.ID); w.Code != http.StatusBadRequest {
		t.Fatalf("dismiss self: expected 400, got %d", w.Code)
	}
	if w := dismiss(uuid.New()); w.Code != http.StatusNotFound {
		t.Fatalf("dismiss unknown: expected 404, got %d", w.Code)
	}

	resp := f10GetSuggestions(t, viewer.ID, "")
	if len(resp.Suggestions) != 1 || resp.Suggestions[0].ID != kept.ID {
		t.Fatalf("expected only the kept candidate after dismissal, got %+v", resp.Suggestions)
	}

	var rows int64
	db.DB.Model(&models.SuggestionDismissal{}).
		Where("user_id = ? AND dismissed_user_id = ?", viewer.ID, candidate.ID).Count(&rows)
	if rows != 1 {
		t.Fatalf("expected exactly 1 stored dismissal, got %d", rows)
	}
}
