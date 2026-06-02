package notifications

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/ws"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

const dedupeWindow = 60 * time.Second

// Broadcaster sends a realtime event to a user.
type Broadcaster func(userID string, msgType string, data interface{})

// Service centralizes durable notification writes, preference checks, dedupe,
// and optional realtime notification fanout.
type Service struct {
	db        *gorm.DB
	broadcast Broadcaster
	now       func() time.Time
}

// CreateRequest describes a notification to deliver.
type CreateRequest struct {
	UserID     uuid.UUID
	Type       models.NotificationType
	Title      string
	Body       string
	ActionURL  string
	ActionType string

	ActorID    *uuid.UUID
	TargetType string
	TargetID   *uuid.UUID

	Dedupe   bool
	Realtime bool
	// RealtimeType defaults to ws.MsgTypeNotification when Realtime is true.
	RealtimeType string
	RealtimeData interface{}
}

// NewService returns a notification service backed by the supplied database and broadcaster.
func NewService(database *gorm.DB, broadcaster Broadcaster) *Service {
	return &Service{
		db:        database,
		broadcast: broadcaster,
		now:       time.Now,
	}
}

// DefaultService returns the app-wide notification service.
func DefaultService() *Service {
	return NewService(db.Social(), ws.BroadcastToUser)
}

// DefaultPreferences returns the same default preference set exposed by the API.
func DefaultPreferences(userID uuid.UUID) models.NotificationPreference {
	return models.NotificationPreference{
		UserID:               userID,
		SocialInApp:          true,
		SocialEmail:          true,
		SocialPush:           false,
		BusinessInApp:        true,
		BusinessEmail:        true,
		BusinessPush:         true,
		CommunityInApp:       true,
		CommunityEmail:       true,
		CommunityPush:        false,
		SystemInApp:          true,
		SystemEmail:          true,
		SystemPush:           true,
		EmailDigestFrequency: "immediate",
		DigestDay:            "monday",
		DigestHour:           9,
	}
}

// Create persists a notification when preferences allow it and optionally
// broadcasts a realtime notification event. The bool return is true only when a
// new durable notification was created.
func (s *Service) Create(ctx context.Context, req CreateRequest) (*models.Notification, bool, error) {
	if s == nil || s.db == nil {
		return nil, false, errors.New("notification service database is nil")
	}
	if req.UserID == uuid.Nil {
		return nil, false, errors.New("notification user_id is required")
	}
	if req.Type == "" {
		return nil, false, errors.New("notification type is required")
	}
	if req.Title == "" {
		return nil, false, errors.New("notification title is required")
	}

	prefs, err := s.preferences(ctx, req.UserID)
	if err != nil {
		return nil, false, err
	}
	if !prefs.ShouldSendToChannel(req.Type, "in_app") {
		return nil, false, nil
	}

	database := s.db.WithContext(ctx)
	if req.Dedupe {
		duplicate, err := s.hasRecentDuplicate(database, req)
		if err != nil {
			return nil, false, err
		}
		if duplicate {
			return nil, false, nil
		}
	}

	delivered := []string{"in_app"}
	if req.Realtime {
		delivered = append(delivered, "realtime")
	}

	notification := &models.Notification{
		ID:                uuid.New(),
		UserID:            req.UserID,
		Type:              req.Type,
		Title:             req.Title,
		Body:              req.Body,
		ActionURL:         req.ActionURL,
		ActionType:        req.ActionType,
		ActorID:           req.ActorID,
		TargetType:        req.TargetType,
		TargetID:          req.TargetID,
		ChannelsDelivered: jsonStringArray(delivered),
		CreatedAt:         s.now(),
	}

	if err := database.Create(notification).Error; err != nil {
		return nil, false, err
	}

	if req.Realtime && s.broadcast != nil {
		msgType := req.RealtimeType
		if msgType == "" {
			msgType = ws.MsgTypeNotification
		}
		data := req.RealtimeData
		if data == nil {
			data = notification
		}
		s.broadcast(req.UserID.String(), msgType, data)
	}

	return notification, true, nil
}

func (s *Service) preferences(ctx context.Context, userID uuid.UUID) (models.NotificationPreference, error) {
	var prefs models.NotificationPreference
	err := s.db.WithContext(ctx).First(&prefs, "user_id = ?", userID).Error
	if err == nil {
		return prefs, nil
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return DefaultPreferences(userID), nil
	}
	return models.NotificationPreference{}, err
}

func (s *Service) hasRecentDuplicate(database *gorm.DB, req CreateRequest) (bool, error) {
	query := database.Model(&models.Notification{}).
		Where("user_id = ? AND type = ? AND is_read = false AND created_at > ?",
			req.UserID, req.Type, s.now().Add(-dedupeWindow))

	if req.ActorID != nil {
		query = query.Where("actor_id = ?", *req.ActorID)
	} else {
		query = query.Where("actor_id IS NULL")
	}

	if req.TargetType != "" {
		query = query.Where("target_type = ?", req.TargetType)
	} else {
		query = query.Where("(target_type = '' OR target_type IS NULL)")
	}

	if req.TargetID != nil {
		query = query.Where("target_id = ?", *req.TargetID)
	} else {
		query = query.Where("target_id IS NULL")
	}

	var count int64
	if err := query.Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

func jsonStringArray(values []string) datatypes.JSON {
	data, _ := json.Marshal(values)
	return datatypes.JSON(data)
}
