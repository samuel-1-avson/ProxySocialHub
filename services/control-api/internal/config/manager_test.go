package config

import "testing"

func TestRefreshAllWithoutRedisReturnsNil(t *testing.T) {
	manager := NewConfigManager(nil, nil)

	if err := manager.RefreshAll(); err != nil {
		t.Fatalf("RefreshAll returned error without Redis: %v", err)
	}
}
