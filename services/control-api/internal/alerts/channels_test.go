package alerts

import "testing"

func TestNewHasNoSaaSChannels(t *testing.T) {
	t.Setenv("SLACK_ALERT_WEBHOOK_URL", "https://hooks.slack.com/services/SHOULD_BE_IGNORED")
	t.Setenv("PAGERDUTY_ROUTING_KEY", "pd-should-be-ignored")
	t.Setenv("ALERT_WEBHOOK_URL", "")
	c := New()
	if c.webhookURL != "" {
		t.Fatalf("expected empty webhook, got %q", c.webhookURL)
	}
	if !c.IsConfigured() {
		t.Fatal("platform alerts should always be configured (journal+log)")
	}
}

func TestOptionalSelfHostedWebhook(t *testing.T) {
	t.Setenv("ALERT_WEBHOOK_URL", "http://ntfy.local/proxyhubb")
	c := New()
	if c.webhookURL != "http://ntfy.local/proxyhubb" {
		t.Fatalf("webhook=%q", c.webhookURL)
	}
}
