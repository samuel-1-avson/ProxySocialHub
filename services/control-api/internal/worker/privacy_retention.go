package worker

import (
	"github.com/proxyhubb/control-api/internal/db"
	"log"
	"time"
)

// These operational records have bounded retention. Financial records are not
// included: their applicable retention is an explicit deployment policy.
func prunePrivacyRecords(now time.Time) error {
	if db.DB == nil {
		return nil
	}
	for _, q := range []struct {
		table, predicate string
		cutoff           time.Time
	}{
		{"auth_mfa_challenges", "expires_at < ?", now.Add(-24 * time.Hour)},
		{"refresh_token_families", "expires_at < ?", now.Add(-30 * 24 * time.Hour)},
		{"user_sessions", "expires_at < ?", now.Add(-30 * 24 * time.Hour)},
		{"login_attempts", "created_at < ?", now.Add(-90 * 24 * time.Hour)},
		{"marketplace_funnel_events", "created_at < ?", now.Add(-30 * 24 * time.Hour)},
	} {
		if err := db.DB.Exec("DELETE FROM "+q.table+" WHERE "+q.predicate, q.cutoff).Error; err != nil {
			return err
		}
	}
	return db.DB.Exec("UPDATE audit_logs SET ip_address = NULL, user_agent = NULL, metadata = '{}' WHERE created_at < ?", now.Add(-90*24*time.Hour)).Error
}

func StartPrivacyRetentionWorker() {
	GoSupervised("PrivacyRetention", 5*time.Second, func() {
		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()
		for {
			if err := prunePrivacyRecords(time.Now()); err != nil {
				log.Printf("[PrivacyRetention] cleanup failed: %v", err)
			}
			<-ticker.C
		}
	})
}
