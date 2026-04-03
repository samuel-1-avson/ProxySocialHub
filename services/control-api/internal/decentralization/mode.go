package decentralization

import (
	"os"
	"strings"
)

// FullModeEnabled returns true when the runtime should reject centralized
// fallbacks and require chain-authoritative execution for critical flows.
func FullModeEnabled() bool {
	raw := strings.ToLower(strings.TrimSpace(os.Getenv("FULL_DECENTRALIZATION")))
	switch raw {
	case "1", "true", "yes", "on", "full", "strict":
		return true
	default:
		return false
	}
}
