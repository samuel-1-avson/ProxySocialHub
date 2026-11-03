package api

import (
	"archive/zip"
	"database/sql"
	"encoding/json"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
	"os"
	"strings"
	"time"
)

type exportClass struct{ Table, Columns, Scope string }

// Versioned allowlist: never SELECT * on credential, custody, or security tables.
// A failing class aborts the archive before any successful download is returned.
var accountExportClasses = []exportClass{
	{"orders", "id,buyer_id,seller_id,listing_id,status,bandwidth_gb,total_price,tx_hash,created_at,updated_at", "buyer_id = @uid OR seller_id = @uid"},
	{"proxy_listings", "id,title,description,country,status,price_per_gb,created_at,updated_at", "seller_id = @uid"},
	{"reviews", "id,listing_id,reviewer_id,seller_id,rating,content,created_at", "reviewer_id = @uid OR seller_id = @uid"},
	{"wallets", "id,balance_lamports,earnings_payable_lamports,created_at,updated_at", "user_id = @uid"},
	{"wallet_ledger_entries", "id,wallet_id,amount_lamports,balance_after_lamports,type,reference_id,description,created_at", "wallet_id IN (SELECT id FROM wallets WHERE user_id = @uid)"},
	{"sessions", "id,node_id,listing_id,type,status,bandwidth_limit,bytes_used,expires_at,created_at", "user_id = @uid"},
	{"conversations", "id,participant1,participant2,listing_id,created_at,last_message_at", "participant1 = @uid OR participant2 = @uid"},
	{"messages", "id,conversation_id,sender_id,CASE WHEN is_deleted THEN '[deleted]' ELSE content END AS content,type,created_at,edited_at,is_deleted", "conversation_id IN (SELECT id FROM conversations WHERE participant1 = @uid OR participant2 = @uid)"},
	{"friend_requests", "id,sender_id,receiver_id,status,created_at", "sender_id = @uid OR receiver_id = @uid"},
	{"friendships", "user_id,friend_id,created_at", "user_id = @uid"},
	{"follows", "follower_id,following_id,created_at", "follower_id = @uid OR following_id = @uid"},
	{"blocks", "blocker_id,blocked_id,created_at", "blocker_id = @uid"},
	{"forum_threads", "id,title,content,created_at", "author_id = @uid"},
	{"forum_posts", "id,thread_id,content,created_at", "author_id = @uid"},
	{"feed_events", "id,event_type,content,created_at", "actor_id = @uid"},
	{"notifications", "id,type,title,body,is_read,created_at", "user_id = @uid"},
	{"user_settings", "session_timeout,max_concurrent_sessions,two_factor_enabled,preferred_language,theme,timezone,created_at,updated_at", "user_id = @uid"},
	{"user_sessions", "id,device_type,browser,os,ip_address,is_active,last_active_at,expires_at,created_at", "user_id = @uid"},
	{"api_keys", "id,name,created_at,expires_at,last_used_at", "user_id = @uid"},
	{"user_identities", "id,provider,created_at,last_login_at", "user_id = @uid"},
	{"embedded_wallets", "id,chain,address,created_at", "user_id = @uid"},
	{"cashouts", "id,reference,lamports,amount_minor,currency,status,created_at,updated_at", "user_id = @uid"},
	{"audit_logs", "id,event_type,severity,target_type,target_id,description,success,created_at", "actor_id = @uid"},
	{"marketplace_funnel_events", "id,event_name,surface,created_at", "user_id = @uid"},
	{"linked_wallets", "id,chain,address,verified,is_primary,label,created_at,updated_at", "user_id = @uid"},
	{"saved_listings", "listing_id,created_at", "user_id = @uid"},
	{"user_badges", "badge_id,earned_at", "user_id = @uid"},
	{"circle_members", "id,circle_id,role,status,joined_at", "user_id = @uid"},
	{"payout_destinations", "id,type,network,phone_last4,account_name,created_at,updated_at", "user_id = @uid"},
	{"pending_transactions", "id,reference,type,amount,currency,status,created_at,updated_at", "user_id = @uid"},
	{"provider_earnings", "id,node_id,session_id,net_amount_sol,status,tx_hash,created_at,paid_at", "provider_user_id = @uid"},
	{"withdrawal_payout_queue", "id,reference,destination,amount_sol,status,tx_hash,created_at,updated_at", "user_id = @uid"},
	{"provider_nodes", "id,name,country,status,created_at", "user_id = @uid"},
}

func requestDataExport(c *gin.Context) {
	uid, ok := GetUserID(c)
	if !ok {
		c.JSON(401, gin.H{"error": "Authentication required"})
		return
	}
	c.Header("Cache-Control", "no-store")
	file, err := os.CreateTemp("", "proxyhubb-export-*.zip")
	if err != nil {
		c.JSON(503, gin.H{"error": "Export unavailable"})
		return
	}
	defer os.Remove(file.Name())
	defer file.Close()
	// Temporary archive permissions are owner-only. Rows stream to disk rather
	// than accumulating the entire account in the web process heap.
	err = db.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var user models.User
		if err := tx.First(&user, "id = ?", uid).Error; err != nil {
			return err
		}
		zw := zip.NewWriter(file)
		write := func(name string, v interface{}) error {
			w, e := zw.Create(name)
			if e != nil {
				return e
			}
			return json.NewEncoder(w).Encode(v)
		}
		if err := write("account.json", gin.H{"identity": user.ToAccountIdentity(), "privacy": privacyFrom(user), "tax_id": user.TaxID, "scheduled_deletion_at": user.ScheduledDeletionAt}); err != nil {
			return err
		}
		counts := map[string]int{}
		for _, class := range accountExportClasses {
			w, err := zw.Create(class.Table + ".jsonl")
			if err != nil {
				return err
			}
			rows, err := tx.Table(class.Table).Select(class.Columns).Where(class.Scope, sql.Named("uid", uid)).Rows()
			if err != nil {
				return fmt.Errorf("export %s: %w", class.Table, err)
			}
			names, err := rows.Columns()
			if err != nil {
				rows.Close()
				return err
			}
			enc := json.NewEncoder(w)
			for rows.Next() {
				values := make([]interface{}, len(names))
				ptrs := make([]interface{}, len(names))
				for i := range values {
					ptrs[i] = &values[i]
				}
				if err := rows.Scan(ptrs...); err != nil {
					rows.Close()
					return err
				}
				row := map[string]interface{}{}
				for i, name := range names {
					if b, ok := values[i].([]byte); ok {
						row[name] = string(b)
					} else {
						row[name] = values[i]
					}
				}
				if err := enc.Encode(row); err != nil {
					rows.Close()
					return err
				}
				counts[class.Table]++
			}
			err = rows.Err()
			rows.Close()
			if err != nil {
				return err
			}
		}
		if err := write("manifest.json", gin.H{"schema_version": 2, "generated_at": time.Now().UTC(), "classes": accountExportClasses, "row_counts": counts, "format": "Each jsonl line is a record. account.json contains your private account identity.", "excluded": "Usable credentials, MFA seeds, backup-code hashes, private keys, other users' private profiles, internal fraud signals, external vendor data and public-chain history. Public chain and required payment records can outlive account closure."}); err != nil {
			return err
		}
		return zw.Close()
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		c.JSON(503, gin.H{"error": "Export failed; no partial archive was returned"})
		return
	}
	info, err := file.Stat()
	if err != nil {
		c.JSON(503, gin.H{"error": "Export unavailable"})
		return
	}
	if _, err = file.Seek(0, 0); err != nil {
		c.JSON(503, gin.H{"error": "Export unavailable"})
		return
	}
	RecordAuditLog(c, models.AuditUserUpdated, models.AuditSeverityInfo, &uid, "user", uid.String(), "Account export completed", true)
	c.Header("Content-Disposition", "attachment; filename=proxyhubb_export_"+time.Now().Format("20060102")+".zip")
	c.DataFromReader(200, info.Size(), "application/zip", file, map[string]string{"X-Export-Schema": "2"})
}

// Keep the inventory safe even as classes are extended.
func exportHasSecrets() bool {
	for _, class := range accountExportClasses {
		for _, secret := range []string{"*", "password", "token_hash", "refresh_token", "two_factor_secret", "sealed_key", "wrapped_dek", "backup_codes"} {
			if strings.Contains(class.Columns, secret) {
				return true
			}
		}
	}
	return false
}
