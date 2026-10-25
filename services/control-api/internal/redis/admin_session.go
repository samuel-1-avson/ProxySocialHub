package redis

import (
	"context"
	"fmt"
	"time"
)

// AdminSessionBlocklistPrefix is the key prefix for revoked admin session ids (JWT "jti").
const AdminSessionBlocklistPrefix = "admin:session:blocked:"

// BlockAdminSession revokes an admin session id until ttl has passed. The ttl should be the
// time the token has left, since it is useless after it expires anyway.
func BlockAdminSession(jti string, ttl time.Duration) error {
	if Client == nil {
		return fmt.Errorf("redis client not initialized")
	}
	return Client.Set(context.Background(), AdminSessionBlocklistPrefix+jti, "1", ttl).Err()
}

// IsAdminSessionBlocked reports whether the session id has been revoked. With no Redis
// there is nothing to consult, so it returns false.
func IsAdminSessionBlocked(jti string) bool {
	if Client == nil || jti == "" {
		return false
	}
	val, err := Client.Get(context.Background(), AdminSessionBlocklistPrefix+jti).Result()
	return err == nil && val == "1"
}
