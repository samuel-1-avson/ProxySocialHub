package api

import (
	"context"

	"github.com/proxyhubb/control-api/internal/cache"
	"github.com/proxyhubb/control-api/internal/logging"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
)

func invalidateMarketplaceReadModels() {
	if err := cache.DeletePattern("listings:sla:*"); err != nil {
		logging.Warn().Err(err).Msg("failed to invalidate listing cache")
	}
	if err := cache.Delete("listings:facets:v1"); err != nil {
		logging.Warn().Err(err).Msg("failed to invalidate listing facets cache")
	}
	if err := cache.Delete("listings:collections:v1"); err != nil {
		logging.Warn().Err(err).Msg("failed to invalidate listing collections cache")
	}
	invalidateRedisPattern("marketplace:geo:*")
	invalidateRedisPattern("marketplace:map:*")
	invalidateRedisPattern("discovery:*")
	if redisClient.Client != nil {
		if err := redisClient.Client.Del(context.Background(), "public:feed").Err(); err != nil {
			logging.Warn().Err(err).Msg("failed to invalidate public feed cache")
		}
	}
}

func invalidateRedisPattern(pattern string) {
	if redisClient.Client == nil {
		return
	}

	ctx := context.Background()
	var cursor uint64
	for {
		keys, nextCursor, err := redisClient.Client.Scan(ctx, cursor, pattern, 100).Result()
		if err != nil {
			logging.Warn().Err(err).Str("pattern", pattern).Msg("failed to scan redis cache keys")
			return
		}
		if len(keys) > 0 {
			if err := redisClient.Client.Del(ctx, keys...).Err(); err != nil {
				logging.Warn().Err(err).Str("pattern", pattern).Msg("failed to delete redis cache keys")
				return
			}
		}
		cursor = nextCursor
		if cursor == 0 {
			return
		}
	}
}
