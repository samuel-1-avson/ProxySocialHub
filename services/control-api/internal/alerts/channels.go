// Package alerts provides platform-native multi-channel alerting.
// Critical paths (treasury reconciliation, oracle velocity, settlement) call Send
// so operators see issues in a durable journal + NATS — not SaaS chat/pager buses.
package alerts

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	internalNats "github.com/proxyhubb/control-api/internal/nats"
)

// Level represents alert severity.
type Level string

const (
	Info     Level = "info"
	Warning  Level = "warning"
	Critical Level = "critical"
)

const natsAlertSubject = "proxy.ops.v1.alerts"

var alertsTotal = promauto.NewCounterVec(
	prometheus.CounterOpts{
		Namespace: "proxyhubb",
		Subsystem: "alerts",
		Name:      "sent_total",
		Help:      "Alerts dispatched by level.",
	},
	[]string{"level"},
)

// Channels holds optional delivery destinations beyond the durable journal.
// Construct with New() which reads from environment variables.
type Channels struct {
	// Optional self-hosted generic webhook (ntfy, Matrix bridge, custom). Not Slack.
	webhookURL string
	httpClient *http.Client
}

// New creates a Channels instance from environment variables:
//
//	ALERT_WEBHOOK_URL — optional self-hosted webhook (JSON POST)
func New() *Channels {
	return &Channels{
		webhookURL: strings.TrimSpace(os.Getenv("ALERT_WEBHOOK_URL")),
		httpClient: &http.Client{Timeout: 5 * time.Second},
	}
}

type alertEvent struct {
	ID        string `json:"id"`
	Level     string `json:"level"`
	Title     string `json:"title"`
	Message   string `json:"message"`
	Source    string `json:"source"`
	Timestamp string `json:"timestamp"`
}

// Send dispatches an alert: always logs + journals; NATS and optional webhook are best-effort.
func (c *Channels) Send(level Level, title, message string) {
	alertsTotal.WithLabelValues(string(level)).Inc()

	logging.Warn().
		Str("alert_level", string(level)).
		Str("alert_title", title).
		Msg(message)

	id := uuid.New().String()
	ts := time.Now().UTC()
	ev := alertEvent{
		ID:        id,
		Level:     string(level),
		Title:     title,
		Message:   message,
		Source:    "control-api",
		Timestamp: ts.Format(time.RFC3339),
	}

	natsOK := false
	hookOK := false

	if err := c.publishNATS(ev); err != nil {
		logging.Warn().Err(err).Msg("alerts: NATS publish failed")
	} else {
		natsOK = true
	}

	if c.webhookURL != "" {
		if err := c.sendWebhook(ev); err != nil {
			logging.Warn().Err(err).Msg("alerts: webhook delivery failed")
		} else {
			hookOK = true
		}
	}

	c.persist(level, title, message, id, natsOK, hookOK)
}

func (c *Channels) persist(level Level, title, message, id string, natsOK, hookOK bool) {
	if db.DB == nil {
		return
	}
	// Best-effort; table may not exist until migration 000143.
	err := db.DB.Exec(`
		INSERT INTO ops_alerts (id, created_at, level, title, message, source, delivered_nats, delivered_hook)
		VALUES (?, NOW(), ?, ?, ?, 'control-api', ?, ?)
	`, id, string(level), title, message, natsOK, hookOK).Error
	if err != nil {
		logging.Warn().Err(err).Msg("alerts: durable journal insert failed")
	}
}

func (c *Channels) publishNATS(ev alertEvent) error {
	body, err := json.Marshal(ev)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	// Prefer JetStream when OPS stream exists; fall back to core NATS.
	if internalNats.JS != nil {
		if err := internalNats.Publish(ctx, natsAlertSubject, ev); err == nil {
			return nil
		}
	}
	if internalNats.Conn == nil {
		return fmt.Errorf("nats not initialized")
	}
	return internalNats.Conn.Publish(natsAlertSubject, body)
}

func (c *Channels) sendWebhook(ev alertEvent) error {
	body, err := json.Marshal(ev)
	if err != nil {
		return err
	}
	resp, err := c.httpClient.Post(c.webhookURL, "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("webhook status %d", resp.StatusCode)
	}
	return nil
}

// IsConfigured reports whether durable/platform alerting is active.
// Journal + log always work after Init; optional webhook is additive.
func (c *Channels) IsConfigured() bool {
	return true
}

// Global is the package-level instance, initialised once in main.go via Init().
var Global *Channels

// Init initialises the package-level Global instance. Call once from main.go.
func Init() {
	Global = New()
	logging.Info().
		Bool("optional_webhook", Global.webhookURL != "").
		Msg("Alert channels ready (durable ops_alerts journal + NATS; no Slack/PagerDuty)")
}

// Send is a convenience wrapper around Global.Send. Safe if Init() was not called.
func Send(level Level, title, message string) {
	if Global == nil {
		logging.Warn().Str("title", title).Msg("[alert not delivered — alerts.Init() not called] " + message)
		return
	}
	Global.Send(level, title, message)
}
