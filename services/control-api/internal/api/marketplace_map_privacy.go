package api

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

// mapOpaqueID returns a stable non-reversible public id for map payloads.
func mapOpaqueID(kind, raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(kind + ":" + raw))
	return hex.EncodeToString(sum[:8])
}

// coarseNetworkClass maps supply type to a non-identifying network class.
func coarseNetworkClass(proxyType, connectionType string) string {
	raw := strings.ToLower(strings.TrimSpace(connectionType))
	if raw == "" {
		raw = strings.ToLower(strings.TrimSpace(proxyType))
	}
	switch {
	case strings.Contains(raw, "mobile"):
		return "mobile"
	case strings.Contains(raw, "datacenter"), strings.Contains(raw, "data_center"), strings.Contains(raw, "dc"):
		return "datacenter"
	case strings.Contains(raw, "fiber"):
		return "fiber"
	case strings.Contains(raw, "residential"), strings.Contains(raw, "resi"):
		return "residential"
	default:
		if raw == "" {
			return "unknown"
		}
		return "residential"
	}
}

// mapTrustBadge derives a buyer-facing quality badge (not a chain validator).
func mapTrustBadge(uptime, quality, success float64, highQualityFlag bool) string {
	if highQualityFlag || quality >= 90 {
		return "high_quality"
	}
	if uptime >= 99 {
		return "high_uptime"
	}
	if success >= 95 && quality >= 70 {
		return "reliable"
	}
	if quality >= 70 || uptime >= 95 {
		return "standard"
	}
	return "basic"
}

func mapTrustLabel(badge string) string {
	switch badge {
	case "high_quality":
		return "High quality"
	case "high_uptime":
		return "High uptime"
	case "reliable":
		return "Reliable"
	case "standard":
		return "Standard"
	default:
		return "Basic"
	}
}

func privacyNodeTitle(city, country, networkClass string) string {
	class := networkClass
	if class == "" || class == "unknown" {
		class = "proxy"
	}
	if len(class) > 0 {
		class = strings.ToUpper(class[:1]) + class[1:]
	}
	loc := strings.TrimSpace(city)
	if loc == "" {
		loc = strings.TrimSpace(country)
	}
	if loc == "" {
		return class + " node"
	}
	return class + " · " + loc
}

func sanitizeListingMapTitle(title string) string {
	title = strings.TrimSpace(title)
	if title == "" {
		return "Marketplace listing"
	}
	// Keep commercial titles; they are not account identifiers.
	return title
}
