package db

import (
	"context"
	"time"
)

type contextKey string

const dbStartTimeKey contextKey = "db_start_time"

// contextWithStartTime stamps the current time into a context for DB timing.
func contextWithStartTime(ctx context.Context) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, dbStartTimeKey, time.Now())
}

// startTimeFromContext retrieves the start time stamped by contextWithStartTime.
func startTimeFromContext(ctx context.Context) (time.Time, bool) {
	if ctx == nil {
		return time.Time{}, false
	}
	t, ok := ctx.Value(dbStartTimeKey).(time.Time)
	return t, ok
}
