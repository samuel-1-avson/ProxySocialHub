package db

import (
	"os"

	"github.com/proxyhubb/control-api/internal/models"
)

// GetSystemSetting fetches a setting from the database system_configurations table.
// If not found in DB, it falls back to Environment Variable, then to defaultVal.
func GetSystemSetting(key, envVar, defaultVal string) string {
	// 1. Try DB
	if DB != nil {
		var config models.SystemConfiguration
		if err := DB.Where("key = ?", key).First(&config).Error; err == nil {
			return config.Value
		}
	}

	// 2. Try Env (if DB miss)
	if envVar != "" {
		if val := os.Getenv(envVar); val != "" {
			return val
		}
	}

	// 3. Default
	return defaultVal
}
