package api

import (
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func TestGetUserIDAcceptsLegacyAndCurrentContextKeys(t *testing.T) {
	gin.SetMode(gin.TestMode)
	expected := uuid.New()

	tests := []struct {
		name  string
		key   string
		value interface{}
	}{
		{name: "user_id uuid", key: "user_id", value: expected},
		{name: "user_id string", key: "user_id", value: expected.String()},
		{name: "userID uuid", key: "userID", value: expected},
		{name: "userID string", key: "userID", value: expected.String()},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(nil)
			c.Set(test.key, test.value)

			got, ok := GetUserID(c)
			if !ok {
				t.Fatalf("GetUserID did not find user id")
			}
			if got != expected {
				t.Fatalf("GetUserID = %s, want %s", got, expected)
			}
		})
	}
}

func TestGetUserIDRejectsInvalidValues(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(nil)
	c.Set("user_id", "not-a-uuid")

	if got, ok := GetUserID(c); ok || got != uuid.Nil {
		t.Fatalf("GetUserID = (%s, %v), want nil false", got, ok)
	}
}
