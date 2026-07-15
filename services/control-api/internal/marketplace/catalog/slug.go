package catalog

import (
	"regexp"
	"strings"

	"github.com/google/uuid"
)

var nonSlugChars = regexp.MustCompile(`[^a-z0-9]+`)

// Slugify builds a URL-safe slug from title, with a short id suffix for uniqueness.
func Slugify(title string, id uuid.UUID) string {
	base := strings.ToLower(strings.TrimSpace(title))
	if base == "" {
		base = "product"
	}
	base = nonSlugChars.ReplaceAllString(base, "-")
	base = strings.Trim(base, "-")
	if base == "" {
		base = "product"
	}
	if len(base) > 80 {
		base = base[:80]
		base = strings.TrimRight(base, "-")
	}
	suffix := strings.ReplaceAll(id.String(), "-", "")[:8]
	return base + "-" + suffix
}

// NormalizeSlug sanitizes a user-provided slug.
func NormalizeSlug(slug string) string {
	s := strings.ToLower(strings.TrimSpace(slug))
	s = nonSlugChars.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if len(s) > 120 {
		s = s[:120]
		s = strings.TrimRight(s, "-")
	}
	return s
}
