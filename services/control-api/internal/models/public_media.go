package models

import (
	"encoding/base64"
	"net/url"
	"os"
	"strings"
)

// SafeProfileMedia allows embedded raster images and explicitly configured
// first-party media origins. A public profile must not load a visitor tracker.
func SafeProfileMedia(raw string) bool {
	if len(raw) > 80000 {
		return false
	}
	for _, prefix := range []string{"data:image/png;base64,", "data:image/jpeg;base64,", "data:image/webp;base64,"} {
		if strings.HasPrefix(raw, prefix) {
			_, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(raw, prefix))
			return err == nil
		}
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil {
		return false
	}
	for _, origin := range strings.Split(os.Getenv("PROFILE_MEDIA_ORIGINS"), ",") {
		allowed, err := url.Parse(strings.TrimSpace(origin))
		if err == nil && allowed.Scheme == "https" && strings.EqualFold(allowed.Host, u.Host) {
			return true
		}
	}
	return false
}

func publicMedia(raw *string) *string {
	if raw == nil || !SafeProfileMedia(*raw) {
		return nil
	}
	return raw
}
