package api

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/models"
)

// Public response projections for community endpoints (F01).
//
// Persistence models must never be serialized directly on forum, inbox or
// friends responses: models.User carries private JSON fields (email,
// tax_id, kyc_status, wallet_address, isp) and its AfterFind hook can
// populate decrypted values. Every nested user relation below goes through
// ToPublicProfile(), the same projection as GET /users/:id.

func publicUser(u *models.User) *models.UserPublicProfile {
	if u == nil {
		return nil
	}
	p := u.ToPublicProfile()
	return &p
}

func publicUserValue(u models.User) *models.UserPublicProfile {
	if u.ID == uuid.Nil {
		return nil
	}
	p := u.ToPublicProfile()
	return &p
}

// --- Forum ---

type forumThreadDTO struct {
	ID           uuid.UUID                 `json:"id"`
	CategoryID   uuid.UUID                 `json:"category_id"`
	AuthorID     uuid.UUID                 `json:"author_id"`
	Title        string                    `json:"title"`
	Slug         string                    `json:"slug"`
	Content      string                    `json:"content"`
	IsPinned     bool                      `json:"is_pinned"`
	IsLocked     bool                      `json:"is_locked"`
	IsHidden     bool                      `json:"is_hidden"`
	ViewsCount   int                       `json:"views_count"`
	RepliesCount int                       `json:"replies_count"`
	Upvotes      int                       `json:"upvotes"`
	Downvotes    int                       `json:"downvotes"`
	LastReplyAt  *time.Time                `json:"last_reply_at,omitempty"`
	LastReplyBy  *uuid.UUID                `json:"last_reply_by,omitempty"`
	ListingID    *uuid.UUID                `json:"listing_id,omitempty"`
	CreatedAt    time.Time                 `json:"created_at"`
	UpdatedAt    time.Time                 `json:"updated_at"`
	Category     *models.ForumCategory     `json:"category,omitempty"`
	Author       *models.UserPublicProfile `json:"author,omitempty"`
	LastReplier  *models.UserPublicProfile `json:"last_replier,omitempty"`
	// ViewerVote is the signed-in viewer's own vote (1 = liked); 0 or absent
	// for anonymous viewers.
	ViewerVote int `json:"viewer_vote,omitempty"`
	// HasSolution says a reply has been accepted as the answer.
	HasSolution bool `json:"has_solution,omitempty"`
}

func forumThreadDTOFrom(t models.ForumThread) forumThreadDTO {
	return forumThreadDTO{
		ID:           t.ID,
		CategoryID:   t.CategoryID,
		AuthorID:     t.AuthorID,
		Title:        t.Title,
		Slug:         t.Slug,
		Content:      t.Content,
		IsPinned:     t.IsPinned,
		IsLocked:     t.IsLocked,
		IsHidden:     t.IsHidden,
		ViewsCount:   t.ViewsCount,
		RepliesCount: t.RepliesCount,
		Upvotes:      t.Upvotes,
		Downvotes:    t.Downvotes,
		LastReplyAt:  t.LastReplyAt,
		LastReplyBy:  t.LastReplyBy,
		ListingID:    t.ListingID,
		CreatedAt:    t.CreatedAt,
		UpdatedAt:    t.UpdatedAt,
		Category:     t.Category,
		Author:       publicUser(t.Author),
		LastReplier:  publicUser(t.LastReplier),
	}
}

func forumThreadDTOs(threads []models.ForumThread) []forumThreadDTO {
	out := make([]forumThreadDTO, 0, len(threads))
	for _, t := range threads {
		out = append(out, forumThreadDTOFrom(t))
	}
	return out
}

type forumPostDTO struct {
	ID         uuid.UUID                 `json:"id"`
	ThreadID   uuid.UUID                 `json:"thread_id"`
	AuthorID   uuid.UUID                 `json:"author_id"`
	Content    string                    `json:"content"`
	IsSolution bool                      `json:"is_solution"`
	IsHidden   bool                      `json:"is_hidden"`
	Upvotes    int                       `json:"upvotes"`
	Downvotes  int                       `json:"downvotes"`
	ParentID   *uuid.UUID                `json:"parent_id,omitempty"`
	CreatedAt  time.Time                 `json:"created_at"`
	UpdatedAt  time.Time                 `json:"updated_at"`
	Author     *models.UserPublicProfile `json:"author,omitempty"`
	ViewerVote int                       `json:"viewer_vote,omitempty"`
}

func forumPostDTOFrom(p models.ForumPost) forumPostDTO {
	return forumPostDTO{
		ID:         p.ID,
		ThreadID:   p.ThreadID,
		AuthorID:   p.AuthorID,
		Content:    p.Content,
		IsSolution: p.IsSolution,
		IsHidden:   p.IsHidden,
		Upvotes:    p.Upvotes,
		Downvotes:  p.Downvotes,
		ParentID:   p.ParentID,
		CreatedAt:  p.CreatedAt,
		UpdatedAt:  p.UpdatedAt,
		Author:     publicUser(p.Author),
	}
}

func forumPostDTOs(posts []models.ForumPost) []forumPostDTO {
	out := make([]forumPostDTO, 0, len(posts))
	for _, p := range posts {
		out = append(out, forumPostDTOFrom(p))
	}
	return out
}

// --- Messaging ---

type messageDTO struct {
	ClientMsgID    *string                   `json:"client_msg_id,omitempty"`
	ID             uuid.UUID                 `json:"id"`
	ConversationID uuid.UUID                 `json:"conversation_id"`
	SenderID       uuid.UUID                 `json:"sender_id"`
	Content        string                    `json:"content"`
	ReadAt         *time.Time                `json:"read_at,omitempty"`
	CreatedAt      time.Time                 `json:"created_at"`
	Type           string                    `json:"type"`
	ReplyToID      *uuid.UUID                `json:"reply_to_id,omitempty"`
	EditedAt       *time.Time                `json:"edited_at,omitempty"`
	IsDeleted      bool                      `json:"is_deleted"`
	Sender         *models.UserPublicProfile `json:"sender,omitempty"`
	Reactions      []models.MessageReaction  `json:"reactions,omitempty"`
}

func messageDTOFrom(m models.Message) messageDTO {
	tombstoneDeleted(&m)
	return messageDTO{
		ClientMsgID:    m.ClientMsgID,
		ID:             m.ID,
		ConversationID: m.ConversationID,
		SenderID:       m.SenderID,
		Content:        m.Content,
		ReadAt:         m.ReadAt,
		CreatedAt:      m.CreatedAt,
		Type:           m.Type,
		ReplyToID:      m.ReplyToID,
		EditedAt:       m.EditedAt,
		IsDeleted:      m.IsDeleted,
		Sender:         publicUser(m.Sender),
		Reactions:      m.Reactions,
	}
}

func messageDTOs(messages []models.Message) []messageDTO {
	out := make([]messageDTO, 0, len(messages))
	for _, m := range messages {
		out = append(out, messageDTOFrom(m))
	}
	return out
}

type conversationDTO struct {
	ID            uuid.UUID                 `json:"id"`
	Participant1  uuid.UUID                 `json:"participant1"`
	Participant2  uuid.UUID                 `json:"participant2"`
	ListingID     *uuid.UUID                `json:"listing_id,omitempty"`
	LastMessageAt time.Time                 `json:"last_message_at"`
	CreatedAt     time.Time                 `json:"created_at"`
	User1         *models.UserPublicProfile `json:"user1,omitempty"`
	User2         *models.UserPublicProfile `json:"user2,omitempty"`
	Listing       *models.ProxyListing      `json:"listing,omitempty"`
	Messages      []messageDTO              `json:"messages,omitempty"`
}

func conversationDTOFrom(c models.Conversation) conversationDTO {
	dto := conversationDTO{
		ID:            c.ID,
		Participant1:  c.Participant1,
		Participant2:  c.Participant2,
		ListingID:     c.ListingID,
		LastMessageAt: c.LastMessageAt,
		CreatedAt:     c.CreatedAt,
		User1:         publicUser(c.User1),
		User2:         publicUser(c.User2),
		Listing:       c.Listing,
	}
	if len(c.Messages) > 0 {
		dto.Messages = messageDTOs(c.Messages)
	}
	return dto
}

// conversationWithPreviewDTO mirrors models.ConversationWithPreview's
// flattened JSON shape.
type conversationWithPreviewDTO struct {
	conversationDTO
	LastMessage      *messageDTO               `json:"last_message,omitempty"`
	UnreadCount      int                       `json:"unread_count"`
	OtherParticipant *models.UserPublicProfile `json:"other_participant,omitempty"`
}

func conversationWithPreviewDTOs(rows []models.ConversationWithPreview) []conversationWithPreviewDTO {
	out := make([]conversationWithPreviewDTO, 0, len(rows))
	for _, row := range rows {
		dto := conversationWithPreviewDTO{
			conversationDTO:  conversationDTOFrom(row.Conversation),
			UnreadCount:      row.UnreadCount,
			OtherParticipant: publicUser(row.OtherParticipant),
		}
		if row.LastMessage != nil {
			lm := messageDTOFrom(*row.LastMessage)
			dto.LastMessage = &lm
		}
		out = append(out, dto)
	}
	return out
}

// --- Feed ---

type feedEventDTO struct {
	ID         uuid.UUID                 `json:"id"`
	ActorID    *uuid.UUID                `json:"actor_id,omitempty"`
	EventType  models.FeedEventType      `json:"event_type"`
	TargetType string                    `json:"target_type,omitempty"`
	TargetID   *uuid.UUID                `json:"target_id,omitempty"`
	Content    string                    `json:"content"`
	Metadata   json.RawMessage           `json:"metadata"`
	CreatedAt  time.Time                 `json:"created_at"`
	Actor      *models.UserPublicProfile `json:"actor,omitempty"`
}

func feedEventDTOFrom(e models.FeedEvent) feedEventDTO {
	return feedEventDTO{
		ID:         e.ID,
		ActorID:    e.ActorID,
		EventType:  e.EventType,
		TargetType: e.TargetType,
		TargetID:   e.TargetID,
		Content:    e.Content,
		Metadata:   json.RawMessage(e.Metadata),
		CreatedAt:  e.CreatedAt,
		Actor:      publicUser(e.Actor),
	}
}

func feedEventDTOs(events []models.FeedEvent) []feedEventDTO {
	out := make([]feedEventDTO, 0, len(events))
	for _, e := range events {
		out = append(out, feedEventDTOFrom(e))
	}
	return out
}

// --- Friends ---

type friendshipDTO struct {
	ID        uuid.UUID                 `json:"id"`
	UserID    uuid.UUID                 `json:"user_id"`
	FriendID  uuid.UUID                 `json:"friend_id"`
	CreatedAt time.Time                 `json:"created_at"`
	User      *models.UserPublicProfile `json:"user,omitempty"`
	Friend    *models.UserPublicProfile `json:"friend,omitempty"`
}

func friendshipDTOFrom(f models.Friendship) friendshipDTO {
	return friendshipDTO{
		ID:        f.ID,
		UserID:    f.UserID,
		FriendID:  f.FriendID,
		CreatedAt: f.CreatedAt,
		User:      publicUserValue(f.User),
		Friend:    publicUserValue(f.Friend),
	}
}

func friendshipDTOs(rows []models.Friendship) []friendshipDTO {
	out := make([]friendshipDTO, 0, len(rows))
	for _, f := range rows {
		out = append(out, friendshipDTOFrom(f))
	}
	return out
}

type friendRequestDTO struct {
	ID         uuid.UUID                  `json:"id"`
	SenderID   uuid.UUID                  `json:"sender_id"`
	ReceiverID uuid.UUID                  `json:"receiver_id"`
	Status     models.FriendRequestStatus `json:"status"`
	CreatedAt  time.Time                  `json:"created_at"`
	UpdatedAt  time.Time                  `json:"updated_at"`
	Sender     *models.UserPublicProfile  `json:"sender,omitempty"`
	Receiver   *models.UserPublicProfile  `json:"receiver,omitempty"`
}

func friendRequestDTOFrom(r models.FriendRequest) friendRequestDTO {
	return friendRequestDTO{
		ID:         r.ID,
		SenderID:   r.SenderID,
		ReceiverID: r.ReceiverID,
		Status:     r.Status,
		CreatedAt:  r.CreatedAt,
		UpdatedAt:  r.UpdatedAt,
		Sender:     publicUserValue(r.Sender),
		Receiver:   publicUserValue(r.Receiver),
	}
}

func friendRequestDTOs(rows []models.FriendRequest) []friendRequestDTO {
	out := make([]friendRequestDTO, 0, len(rows))
	for _, r := range rows {
		out = append(out, friendRequestDTOFrom(r))
	}
	return out
}
