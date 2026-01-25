package config

import (
	"context"
	"log"
	"time"

	"github.com/proxyhubb/control-api/internal/models"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
	"gorm.io/gorm"
)

const RedisConfigKey = "sys:config:hash"

type ConfigManager struct {
	redis redisClient.RedisClient
	db    *gorm.DB
}

func NewConfigManager(r redisClient.RedisClient, d *gorm.DB) *ConfigManager {
	return &ConfigManager{
		redis: r,
		db:    d,
	}
}

// Get fetches a config from Redis, fallback to DB
func (m *ConfigManager) Get(key string) (string, error) {
	ctx := context.Background()

	// 1. Try Redis
	val, err := m.redis.HGet(ctx, RedisConfigKey, key).Result()
	if err == nil {
		return val, nil
	}

	// 2. Fallback to DB
	var sysConfig models.SystemConfiguration
	if err := m.db.Where("key = ?", key).First(&sysConfig).Error; err != nil {
		return "", err
	}

	// 3. Populate Redis for next time
	_ = m.redis.HSet(ctx, RedisConfigKey, key, sysConfig.Value)

	return sysConfig.Value, nil
}

// Set updates a config in both DB and Redis
func (m *ConfigManager) Set(key, value, description string) error {
	ctx := context.Background()

	// 1. Update DB (within transaction)
	err := m.db.Transaction(func(tx *gorm.DB) error {
		var sysConfig models.SystemConfiguration
		result := tx.Where("key = ?", key).First(&sysConfig)

		if result.Error != nil {
			// Create new
			sysConfig = models.SystemConfiguration{
				Key:         key,
				Value:       value,
				Description: description,
			}
			return tx.Create(&sysConfig).Error
		}

		// Update existing
		return tx.Model(&sysConfig).Updates(map[string]interface{}{
			"value":       value,
			"description": description,
			"updated_at":  time.Now(),
		}).Error
	})

	if err != nil {
		return err
	}

	// 2. Sync to Redis
	_ = m.redis.HSet(ctx, RedisConfigKey, key, value)

	// 3. Notify Hub (Pub/Sub for Live-Reload)
	_ = m.redis.Publish(ctx, "sys:config:update", key)

	log.Printf("[ConfigManager] Updated key=%s, notified subscribers", key)
	return nil
}

// RefreshAll syncs all DB configs to Redis
func (m *ConfigManager) RefreshAll() error {
	var configs []models.SystemConfiguration
	if err := m.db.Find(&configs).Error; err != nil {
		return err
	}

	ctx := context.Background()
	pipe := m.redis.Pipeline()
	for _, c := range configs {
		pipe.HSet(ctx, RedisConfigKey, c.Key, c.Value)
	}
	_, err := pipe.Exec(ctx)
	return err
}
