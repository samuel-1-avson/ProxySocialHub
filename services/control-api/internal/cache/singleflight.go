package cache

import (
	"encoding/json"
	"time"

	"golang.org/x/sync/singleflight"
)

var loadGroup singleflight.Group

// GetOrLoad returns a cached JSON value or runs load once per key (singleflight),
// then stores the result for ttl. Concurrent cache misses share one loader call.
func GetOrLoad(key string, dest interface{}, ttl time.Duration, load func() (interface{}, error)) error {
	if hit, err := Get(key, dest); err == nil && hit {
		return nil
	}

	v, err, _ := loadGroup.Do(key, func() (interface{}, error) {
		var existing json.RawMessage
		if hit, _ := Get(key, &existing); hit && len(existing) > 0 {
			return []byte(existing), nil
		}

		loaded, loadErr := load()
		if loadErr != nil {
			return nil, loadErr
		}
		_ = Set(key, loaded, ttl)
		raw, marshalErr := json.Marshal(loaded)
		if marshalErr != nil {
			return nil, marshalErr
		}
		return raw, nil
	})
	if err != nil {
		return err
	}

	raw, ok := v.([]byte)
	if !ok {
		return json.Unmarshal([]byte("null"), dest)
	}
	return json.Unmarshal(raw, dest)
}

// Do coalesces concurrent work for an arbitrary key (no cache write).
func Do(key string, fn func() (interface{}, error)) (interface{}, error) {
	v, err, _ := loadGroup.Do(key, fn)
	return v, err
}
