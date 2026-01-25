package privacy

import (
	"regexp"
	"strings"
)

var (
	// emailRegex captures basic email patterns
	emailRegex = regexp.MustCompile(`(?i)[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}`)
	// phoneRegex captures common international and local phone formats
	phoneRegex = regexp.MustCompile(`(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4,}`)
)

// MaskPII replaces sensitive information with asterisks
func MaskPII(text string) string {
	// 1. Mask Emails
	text = emailRegex.ReplaceAllStringFunc(text, func(match string) string {
		parts := strings.Split(match, "@")
		if len(parts) != 2 {
			return match
		}
		// Mask username, keep domain for context if needed, or mask all
		mask := strings.Repeat("*", len(parts[0]))
		return mask + "@" + parts[1]
	})

	// 2. Mask Phone Numbers
	text = phoneRegex.ReplaceAllString(text, "[PHONE MASKED]")

	return text
}

// ContainsPII checks if the text has sensitive patterns
func ContainsPII(text string) bool {
	return emailRegex.MatchString(text) || phoneRegex.MatchString(text)
}
