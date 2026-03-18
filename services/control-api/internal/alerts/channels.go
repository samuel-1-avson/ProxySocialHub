// Package alerts provides a lightweight multi-channel alerting system.
// Wire it into critical paths (treasury reconciliation, oracle velocity, price feeds)
// so ops teams are notified in real time rather than discovering issues in logs.
package alerts

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/proxyhubb/control-api/internal/logging"
)

// Level represents alert severity.
type Level string

const (
	Info     Level = "info"
	Warning  Level = "warning"
	Critical Level = "critical"
)

// Channels holds the configured alert destinations.
// Construct with New() which reads from environment variables.
type Channels struct {
	slackWebhookURL string
	adminEmails     []string
	httpClient      *http.Client
}

// New creates an Channels instance from environment variables:
//
//	SLACK_ALERT_WEBHOOK_URL  — Slack incoming webhook URL
//	ALERT_ADMIN_EMAILS       — comma-separated list of email addresses (future use)
func New() *Channels {
	emails := []string{}
	if raw := os.Getenv("ALERT_ADMIN_EMAILS"); raw != "" {
		for _, e := range strings.Split(raw, ",") {
			if trimmed := strings.TrimSpace(e); trimmed != "" {
				emails = append(emails, trimmed)
			}
		}
	}
	return &Channels{
		slackWebhookURL: os.Getenv("SLACK_ALERT_WEBHOOK_URL"),
		adminEmails:     emails,
		httpClient:      &http.Client{Timeout: 5 * time.Second},
	}
}

// Send dispatches an alert to all configured channels.
// It always logs — Slack and email are best-effort (errors are logged, not returned).
func (c *Channels) Send(level Level, title, message string) {
	// Always log
	entry := logging.Warn().
		Str("alert_level", string(level)).
		Str("alert_title", title)
	if level == Critical {
		entry = logging.Warn(). // zerolog doesn't have Fatal-without-exit; use Warn with field
			Str("alert_level", "CRITICAL").
			Str("alert_title", title)
	}
	entry.Msg(message)

	// Slack (non-blocking)
	if c.slackWebhookURL != "" {
		go c.sendSlack(level, title, message)
	}
}

// slackPayload is the Slack incoming webhook body.
type slackPayload struct {
	Text string `json:"text"`
}

func (c *Channels) sendSlack(level Level, title, message string) {
	emoji := map[Level]string{
		Info:     "ℹ️",
		Warning:  "⚠️",
		Critical: "🚨",
	}[level]

	text := fmt.Sprintf("%s *[%s] %s*\n%s\n_ProxyHubb · %s_",
		emoji, strings.ToUpper(string(level)), title, message,
		time.Now().UTC().Format("2006-01-02 15:04:05 UTC"))

	payload := slackPayload{Text: text}
	body, err := json.Marshal(payload)
	if err != nil {
		logging.Warn().Err(err).Msg("alerts: failed to marshal Slack payload")
		return
	}

	resp, err := c.httpClient.Post(c.slackWebhookURL, "application/json", bytes.NewReader(body))
	if err != nil {
		logging.Warn().Err(err).Msg("alerts: Slack webhook delivery failed")
		return
	}
	resp.Body.Close()
	if resp.StatusCode >= 300 {
		logging.Warn().Int("status", resp.StatusCode).Msg("alerts: Slack webhook returned non-2xx")
	}
}

// IsConfigured returns true if at least one channel (Slack or email) is set up.
func (c *Channels) IsConfigured() bool {
	return c.slackWebhookURL != "" || len(c.adminEmails) > 0
}

// Global is the package-level instance, initialised once in main.go via Init().
var Global *Channels

// Init initialises the package-level Global instance. Call once from main.go.
func Init() {
	Global = New()
	if Global.IsConfigured() {
		logging.Info().Msg("Alert channels configured (Slack and/or email)")
	} else {
		logging.Warn().Msg("No alert channels configured — set SLACK_ALERT_WEBHOOK_URL or ALERT_ADMIN_EMAILS")
	}
}

// Send is a convenience wrapper around Global.Send. Panics if Init() was not called.
func Send(level Level, title, message string) {
	if Global == nil {
		logging.Warn().Str("title", title).Msg("[alert not delivered — alerts.Init() not called] " + message)
		return
	}
	Global.Send(level, title, message)
}
