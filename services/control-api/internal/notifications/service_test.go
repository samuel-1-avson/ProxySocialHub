package notifications

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func TestServiceCreatePersistsDedupesAndBroadcasts(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "notifications", "notification_preferences")

	user := testutil.CreateTestUser(t, testutil.UniqueEmail("notify_user"), "buyer")
	actor := testutil.CreateTestUser(t, testutil.UniqueEmail("notify_actor"), "provider")
	targetID := uuid.New()

	var broadcasts []string
	svc := NewService(db.DB, func(userID string, msgType string, data interface{}) {
		broadcasts = append(broadcasts, msgType)
	})

	notification, delivered, err := svc.Create(context.Background(), CreateRequest{
		UserID:     user.ID,
		Type:       models.NotificationMessage,
		Title:      "New message",
		Body:       "Hello",
		ActorID:    &actor.ID,
		TargetType: "conversation",
		TargetID:   &targetID,
		Dedupe:     true,
		Realtime:   true,
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	if !delivered || notification == nil {
		t.Fatalf("Expected delivered notification, got delivered=%v notification=%v", delivered, notification)
	}
	if len(broadcasts) != 1 || broadcasts[0] != "notification" {
		t.Fatalf("Expected one notification broadcast, got %#v", broadcasts)
	}

	var channels []string
	if err := json.Unmarshal(notification.ChannelsDelivered, &channels); err != nil {
		t.Fatalf("Failed to unmarshal delivered channels: %v", err)
	}
	if len(channels) != 2 || channels[0] != "in_app" || channels[1] != "realtime" {
		t.Fatalf("Unexpected delivered channels: %#v", channels)
	}

	_, delivered, err = svc.Create(context.Background(), CreateRequest{
		UserID:     user.ID,
		Type:       models.NotificationMessage,
		Title:      "New message",
		Body:       "Duplicate",
		ActorID:    &actor.ID,
		TargetType: "conversation",
		TargetID:   &targetID,
		Dedupe:     true,
		Realtime:   true,
	})
	if err != nil {
		t.Fatalf("Duplicate Create failed: %v", err)
	}
	if delivered {
		t.Fatalf("Expected duplicate notification to be suppressed")
	}

	var count int64
	db.DB.Model(&models.Notification{}).Where("user_id = ?", user.ID).Count(&count)
	if count != 1 {
		t.Fatalf("Expected 1 notification after dedupe, got %d", count)
	}
	if len(broadcasts) != 1 {
		t.Fatalf("Expected duplicate to skip broadcast, got %#v", broadcasts)
	}
}

func TestServiceCreateRespectsInAppPreference(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "notifications", "notification_preferences")

	user := testutil.CreateTestUser(t, testutil.UniqueEmail("notify_pref_user"), "buyer")
	prefs := DefaultPreferences(user.ID)
	prefs.SocialInApp = false
	if err := db.DB.Create(&prefs).Error; err != nil {
		t.Fatalf("Failed to create preferences: %v", err)
	}

	broadcasts := 0
	svc := NewService(db.DB, func(userID string, msgType string, data interface{}) {
		broadcasts++
	})

	notification, delivered, err := svc.Create(context.Background(), CreateRequest{
		UserID:   user.ID,
		Type:     models.NotificationMessage,
		Title:    "New message",
		Body:     "Hello",
		Realtime: true,
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	if delivered || notification != nil {
		t.Fatalf("Expected preference to suppress notification, got delivered=%v notification=%v", delivered, notification)
	}
	if broadcasts != 0 {
		t.Fatalf("Expected preference to suppress broadcast, got %d", broadcasts)
	}

	var count int64
	db.DB.Model(&models.Notification{}).Where("user_id = ?", user.ID).Count(&count)
	if count != 0 {
		t.Fatalf("Expected 0 notifications, got %d", count)
	}
}
