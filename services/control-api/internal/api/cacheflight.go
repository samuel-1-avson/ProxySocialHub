package api

import (
	"encoding/json"
	"time"

	"github.com/gin-gonic/gin"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
	"golang.org/x/sync/singleflight"
)

// responseFlight coalesces concurrent cache-miss rebuilds for map/geo endpoints.
var responseFlight singleflight.Group

const marketplaceMapQueryLimit = 2000
const explorerNodeGeoQueryLimit = 2000

// loadCachedOrBuild loads JSON from Redis or runs build once per key (singleflight).
func loadCachedOrBuild(c *gin.Context, key string, ttl time.Duration, dest interface{}, build func() (interface{}, error)) error {
	if redisClient.Client != nil {
		if cached, err := redisClient.Client.Get(c, key).Result(); err == nil && cached != "" {
			if err := json.Unmarshal([]byte(cached), dest); err == nil {
				return nil
			}
		}
	}

	v, err, _ := responseFlight.Do(key, func() (interface{}, error) {
		if redisClient.Client != nil {
			if cached, getErr := redisClient.Client.Get(c, key).Result(); getErr == nil && cached != "" {
				return []byte(cached), nil
			}
		}
		built, buildErr := build()
		if buildErr != nil {
			return nil, buildErr
		}
		raw, marshalErr := json.Marshal(built)
		if marshalErr != nil {
			return nil, marshalErr
		}
		cacheResponse(c, key, built, ttl)
		return raw, nil
	})
	if err != nil {
		return err
	}
	raw, _ := v.([]byte)
	return json.Unmarshal(raw, dest)
}
