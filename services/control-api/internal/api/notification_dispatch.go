package api

import (
	"context"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	notify "github.com/proxyhubb/control-api/internal/notifications"
)

type userNotification struct {
	UserID     uuid.UUID
	Type       models.NotificationType
	Title      string
	Body       string
	ActionURL  string
	ActionType string
	ActorID    *uuid.UUID
	TargetType string
	TargetID   *uuid.UUID
	Dedupe     bool
}

func dispatchUserNotification(ctx context.Context, req userNotification) {
	_, _, err := notify.DefaultService().Create(ctx, notify.CreateRequest{
		UserID:     req.UserID,
		Type:       req.Type,
		Title:      req.Title,
		Body:       req.Body,
		ActionURL:  req.ActionURL,
		ActionType: req.ActionType,
		ActorID:    req.ActorID,
		TargetType: req.TargetType,
		TargetID:   req.TargetID,
		Dedupe:     req.Dedupe,
		Realtime:   true,
	})
	if err != nil {
		logging.Warn().
			Err(err).
			Str("user_id", req.UserID.String()).
			Str("type", string(req.Type)).
			Msg("notification dispatch failed")
	}
}
