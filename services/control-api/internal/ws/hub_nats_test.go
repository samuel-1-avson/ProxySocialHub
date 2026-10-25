package ws

import (
	"testing"
	"time"
)

// BE-MED-01: the hub is created in init(), before main() connects to NATS. Subscribing from
// Run() therefore always found no JetStream and returned, silently dropping every broadcast.
// The subscription must start only when main asks for it, after NATS is up.
func TestHubSubscribesToNATSOnlyWhenStarted(t *testing.T) {
	h := NewHub()
	started := make(chan struct{}, 4)
	h.startNATS = func() { started <- struct{}{} }

	go h.Run()

	select {
	case <-started:
		t.Fatal("Run() started the NATS subscription on its own, before NATS could be connected")
	case <-time.After(150 * time.Millisecond):
	}

	h.StartNATSSubscription()
	h.StartNATSSubscription() // idempotent

	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("StartNATSSubscription did not start the subscription")
	}
	select {
	case <-started:
		t.Fatal("the subscription was started twice")
	case <-time.After(150 * time.Millisecond):
	}
}
