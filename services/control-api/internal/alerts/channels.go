// Package alerts provides a lightweight multi-channel alerting system.
// Wire it into critical paths (treasury reconciliation, oracle velocity, price feeds)
// so ops teams are notified in real time rather than discovering issues in logs.
package alerts

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/smtp"
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
	slackWebhookURL   string
	adminEmails       []string
	pagerdutyKey      string // PAGERDUTY_ROUTING_KEY — Events API v2 integration key
	smtpHost          string // SMTP_HOST
	smtpPort          string // SMTP_PORT (default 587)
	smtpUsername      string // SMTP_USERNAME
	smtpPassword      string // SMTP_PASSWORD
	smtpFrom          string // SMTP_FROM
	httpClient        *http.Client
}

// New creates a Channels instance from environment variables:
//
//	SLACK_ALERT_WEBHOOK_URL   — Slack incoming webhook URL
//	ALERT_ADMIN_EMAILS        — comma-separated recipient email addresses
//	PAGERDUTY_ROUTING_KEY     — PagerDuty Events API v2 integration key
//	SMTP_HOST / SMTP_PORT / SMTP_USERNAME / SMTP_PASSWORD / SMTP_FROM
func New() *Channels {
	emails := []string{}
	if raw := os.Getenv("ALERT_ADMIN_EMAILS"); raw != "" {
		for _, e := range strings.Split(raw, ",") {
			if trimmed := strings.TrimSpace(e); trimmed != "" {
				emails = append(emails, trimmed)
			}
		}
	}
	port := os.Getenv("SMTP_PORT")
	if port == "" {
		port = "587"
	}
	return &Channels{
		slackWebhookURL: os.Getenv("SLACK_ALERT_WEBHOOK_URL"),
		adminEmails:     emails,
		pagerdutyKey:    os.Getenv("PAGERDUTY_ROUTING_KEY"),
		smtpHost:        os.Getenv("SMTP_HOST"),
		smtpPort:        port,
		smtpUsername:    os.Getenv("SMTP_USERNAME"),
		smtpPassword:    os.Getenv("SMTP_PASSWORD"),
		smtpFrom:        os.Getenv("SMTP_FROM"),
		httpClient:      &http.Client{Timeout: 5 * time.Second},
	}
}

// Send dispatches an alert to all configured channels.
// It always logs; Slack, PagerDuty, and email are best-effort (errors logged, not returned).
func (c *Channels) Send(level Level, title, message string) {
	// Always log
	logging.Warn().
		Str("alert_level", string(level)).
		Str("alert_title", title).
		Msg(message)

	// Slack (non-blocking)
	if c.slackWebhookURL != "" {
		go c.sendSlack(level, title, message)
	}

	// PagerDuty — only for Critical alerts
	if c.pagerdutyKey != "" && level == Critical {
		go c.sendPagerDuty(title, message)
	}

	// Email — Critical and Warning
	if c.smtpHost != "" && len(c.adminEmails) > 0 && (level == Critical || level == Warning) {
		go c.sendEmail(level, title, message)
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

// sendPagerDuty triggers a PagerDuty incident via the Events API v2.
func (c *Channels) sendPagerDuty(title, message string) {
	payload := map[string]interface{}{
		"routing_key":  c.pagerdutyKey,
		"event_action": "trigger",
		"payload": map[string]interface{}{
			"summary":   title + ": " + message,
			"severity":  "critical",
			"source":    "proxyhubb-control-api",
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		logging.Warn().Err(err).Msg("alerts: failed to marshal PagerDuty payload")
		return
	}
	resp, err := c.httpClient.Post(
		"https://events.pagerduty.com/v2/enqueue",
		"application/json",
		bytes.NewReader(body),
	)
	if err != nil {
		logging.Warn().Err(err).Msg("alerts: PagerDuty delivery failed")
		return
	}
	resp.Body.Close()
	if resp.StatusCode >= 300 {
		logging.Warn().Int("status", resp.StatusCode).Msg("alerts: PagerDuty returned non-2xx")
	}
}

// sendEmail delivers the alert to all configured admin email addresses via SMTP.
func (c *Channels) sendEmail(level Level, title, message string) {
	subject := fmt.Sprintf("[ProxyHubb %s] %s", strings.ToUpper(string(level)), title)
	body := fmt.Sprintf("Subject: %s\r\nFrom: %s\r\nTo: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n%s\r\n\n-- ProxyHubb · %s",
		subject,
		c.smtpFrom,
		strings.Join(c.adminEmails, ", "),
		message,
		time.Now().UTC().Format("2006-01-02 15:04:05 UTC"),
	)

	auth := smtp.PlainAuth("", c.smtpUsername, c.smtpPassword, c.smtpHost)
	addr := c.smtpHost + ":" + c.smtpPort
	if err := smtp.SendMail(addr, auth, c.smtpFrom, c.adminEmails, []byte(body)); err != nil {
		logging.Warn().Err(err).Msg("alerts: email delivery failed")
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
