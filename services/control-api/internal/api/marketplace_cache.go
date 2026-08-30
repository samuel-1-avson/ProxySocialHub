package api

import (
	"context"
	"time"

	"github.com/proxyhubb/control-api/internal/cache"
	"github.com/proxyhubb/control-api/internal/logging"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
)

func invalidateMarketplaceReadModels() {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()

	if err := cache.DeletePattern("listings:sla:*"); err != nil {
		logging.Warn().Err(err).Msg("failed to invalidate listing cache")
	}
	if err := cache.Delete("listings:facets:v1"); err != nil {
		logging.Warn().Err(err).Msg("failed to invalidate listing facets cache")
	}
	if err := cache.Delete("listings:collections:v1"); err != nil {
		logging.Warn().Err(err).Msg("failed to invalidate listing collections cache")
	}
	invalidateRedisPattern(ctx, "marketplace:geo:*")
	invalidateRedisPattern(ctx, "marketplace:map:*")
	invalidateRedisPattern(ctx, "discovery:*")
	if redisClient.Client != nil {
		if err := redisClient.Client.Del(ctx, "public:feed").Err(); err != nil {
			logging.Warn().Err(err).Msg("failed to invalidate public feed cache")
		}
	}
}

func invalidateRedisPattern(ctx context.Context, pattern string) {
	if redisClient.Client == nil {
		return
	}

	var cursor uint64
	for {
		if err := ctx.Err(); err != nil {
			logging.Warn().Err(err).Str("pattern", pattern).Msg("listing cache invalidation timed out")
			return
		}
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
