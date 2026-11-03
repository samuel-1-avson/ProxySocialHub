package api

import (
	"bytes"
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

// F04 backend contract: stable newest-first history with a cursor that can
// reach beyond the first page (even with equal timestamps), a
// single-conversation fetch for deep links beyond the first list page, and a
// read watermark that never marks unseen arrivals read.

func f04Router(userID uuid.UUID) *gin.Engine {
	r := setupTestRouter()
	r.Use(func(c *gin.Context) { c.Set("user_id", userID); c.Next() })
	return r
}

func f04SeedMessages(t *testing.T, convID, senderID uuid.UUID, n int) []models.Message {
	t.Helper()
	base := time.Date(2026, 11, 1, 10, 0, 0, 0, time.UTC)
	msgs := make([]models.Message, 0, n)
	for i := 0; i < n; i++ {
		// Groups of 5 share one timestamp to exercise the ID tie-breaker.
		m := models.Message{
			ConversationID: convID,
			SenderID:       senderID,
			Content:        fmt.Sprintf("message %02d", i),
			CreatedAt:      base.Add(time.Duration(i/5) * time.Minute),
		}
		if err := db.DB.Create(&m).Error; err != nil {
			t.Fatalf("seed message %d: %v", i, err)
		}
		// Create() may keep the supplied timestamp; force it to be sure.
		if err := db.DB.Model(&models.Message{}).Where("id = ?", m.ID).
			Update("created_at", m.CreatedAt).Error; err != nil {
			t.Fatalf("pin message time %d: %v", i, err)
		}
		msgs = append(msgs, m)
	}
	return msgs
}

type f04MessagePage struct {
	Messages []models.Message `json:"messages"`
	Total    int64            `json:"total"`
	HasMore  bool             `json:"has_more"`
}

func TestF04CursorReachesBeyondFirstPageWithoutDuplicates(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "conversations", "messages")

	viewer := testutil.CreateTestUser(t, testutil.UniqueEmail("f04viewer"), "buyer")
	other := testutil.CreateTestUser(t, testutil.UniqueEmail("f04other"), "provider")
	conv := models.Conversation{Participant1: viewer.ID, Participant2: other.ID}
	if err := db.DB.Create(&conv).Error; err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	f04SeedMessages(t, conv.ID, other.ID, 55)

	r := f04Router(viewer.ID)
	r.GET("/conversations/:id/messages", getMessages)

	fetch := func(query string) f04MessagePage {
		req := httptest.NewRequest("GET", "/conversations/"+conv.ID.String()+"/messages"+query, nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("GET %s: expected 200, got %d. Body: %s", query, w.Code, w.Body.String())
		}
		var page f04MessagePage
		if err := json.Unmarshal(w.Body.Bytes(), &page); err != nil {
			t.Fatalf("decode: %v", err)
		}
		return page
	}

	first := fetch("")
	if len(first.Messages) != 50 {
		t.Fatalf("expected first page of 50, got %d", len(first.Messages))
	}
	if first.Total != 55 {
		t.Fatalf("expected total 55, got %d", first.Total)
	}
	if !first.HasMore {
		t.Fatalf("expected has_more=true on first page")
	}
	// Newest-first with the stable tie-breaker: non-increasing (created_at, id).
	for i := 1; i < len(first.Messages); i++ {
		prev, cur := first.Messages[i-1], first.Messages[i]
		if cur.CreatedAt.After(prev.CreatedAt) ||
			(cur.CreatedAt.Equal(prev.CreatedAt) && cur.ID.String() > prev.ID.String()) {
			t.Fatalf("unstable order at %d: %v/%s then %v/%s", i, prev.CreatedAt, prev.ID, cur.CreatedAt, cur.ID)
		}
	}

	oldest := first.Messages[len(first.Messages)-1]
	rest := fetch("?before=" + oldest.ID.String())
	if len(rest.Messages) != 5 {
		t.Fatalf("expected remaining 5 via cursor, got %d", len(rest.Messages))
	}
	if rest.HasMore {
		t.Fatalf("expected has_more=false at end of history")
	}

	seen := map[uuid.UUID]bool{}
	for _, m := range append(first.Messages, rest.Messages...) {
		if seen[m.ID] {
			t.Fatalf("duplicate message across pages: %s", m.ID)
		}
		seen[m.ID] = true
	}
	if len(seen) != 55 {
		t.Fatalf("expected 55 unique messages, got %d", len(seen))
	}
}

func TestF04GetSingleConversationForDeepLink(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "conversations", "messages")

	viewer := testutil.CreateTestUser(t, testutil.UniqueEmail("f04viewer2"), "buyer")
	other := testutil.CreateTestUser(t, testutil.UniqueEmail("f04other2"), "provider")
	outsider := testutil.CreateTestUser(t, testutil.UniqueEmail("f04outsider"), "buyer")
	conv := models.Conversation{Participant1: viewer.ID, Participant2: other.ID}
	if err := db.DB.Create(&conv).Error; err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	msg := models.Message{ConversationID: conv.ID, SenderID: other.ID, Content: "deep link hello"}
	if err := db.DB.Create(&msg).Error; err != nil {
		t.Fatalf("create message: %v", err)
	}

	get := func(as uuid.UUID, id string) *httptest.ResponseRecorder {
		r := f04Router(as)
		r.GET("/conversations/:id", getConversation)
		req := httptest.NewRequest("GET", "/conversations/"+id, nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}

	w := get(viewer.ID, conv.ID.String())
	if w.Code != http.StatusOK {
		t.Fatalf("participant: expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
	var preview models.ConversationWithPreview
	if err := json.Unmarshal(w.Body.Bytes(), &preview); err != nil {
		t.Fatalf("decode preview: %v", err)
	}
	if preview.ID != conv.ID || preview.LastMessage == nil || preview.LastMessage.ID != msg.ID {
		t.Fatalf("unexpected preview: %+v", preview)
	}
	if preview.UnreadCount != 1 {
		t.Fatalf("expected unread_count 1, got %d", preview.UnreadCount)
	}
	if preview.OtherParticipant == nil || preview.OtherParticipant.ID != other.ID {
		t.Fatalf("expected other participant %s, got %+v", other.ID, preview.OtherParticipant)
	}

	if w := get(outsider.ID, conv.ID.String()); w.Code != http.StatusForbidden {
		t.Fatalf("outsider: expected 403, got %d. Body: %s", w.Code, w.Body.String())
	}
	if w := get(viewer.ID, uuid.New().String()); w.Code != http.StatusNotFound {
		t.Fatalf("missing: expected 404, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestF04MarkAsReadWatermarkLeavesUnseenUnread(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "conversations", "messages")

	reader := testutil.CreateTestUser(t, testutil.UniqueEmail("f04reader"), "buyer")
	other := testutil.CreateTestUser(t, testutil.UniqueEmail("f04sender"), "provider")
	conv := models.Conversation{Participant1: reader.ID, Participant2: other.ID}
	if err := db.DB.Create(&conv).Error; err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	msgs := f04SeedMessages(t, conv.ID, other.ID, 3)
	// Chronological order is seed order here (distinct minutes per group of 5,
	// so use explicit times instead for the watermark boundary).
	base := time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
	for i, m := range msgs {
		if err := db.DB.Model(&models.Message{}).Where("id = ?", m.ID).
			Update("created_at", base.Add(time.Duration(i)*time.Minute)).Error; err != nil {
			t.Fatalf("pin time: %v", err)
		}
	}

	r := f04Router(reader.ID)
	r.POST("/conversations/:id/read", markAsRead)

	body, _ := json.Marshal(map[string]string{"up_to_message_id": msgs[1].ID.String()})
	req := httptest.NewRequest("POST", "/conversations/"+conv.ID.String()+"/read", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("watermark read: expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	readStates := make([]bool, 3)
	for i, m := range msgs {
		var stored models.Message
		db.DB.First(&stored, "id = ?", m.ID)
		readStates[i] = stored.ReadAt != nil
	}
	if !readStates[0] || !readStates[1] || readStates[2] {
		t.Fatalf("expected first two read and third unread, got %v", readStates)
	}

	// Anchor from another conversation must be rejected.
	otherConv := models.Conversation{Participant1: reader.ID, Participant2: other.ID}
	if err := db.DB.Create(&otherConv).Error; err != nil {
		t.Fatalf("create second conversation: %v", err)
	}
	foreign := models.Message{ConversationID: otherConv.ID, SenderID: other.ID, Content: "foreign"}
	if err := db.DB.Create(&foreign).Error; err != nil {
		t.Fatalf("create foreign message: %v", err)
	}
	body, _ = json.Marshal(map[string]string{"up_to_message_id": foreign.ID.String()})
	req = httptest.NewRequest("POST", "/conversations/"+conv.ID.String()+"/read", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("foreign anchor: expected 400, got %d. Body: %s", w.Code, w.Body.String())
	}

	// No body keeps the legacy mark-everything behavior.
	req = httptest.NewRequest("POST", "/conversations/"+conv.ID.String()+"/read", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("mark all: expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
	var third models.Message
	db.DB.First(&third, "id = ?", msgs[2].ID)
	if third.ReadAt == nil {
		t.Fatalf("expected mark-all to read the remaining message")
	}
}
