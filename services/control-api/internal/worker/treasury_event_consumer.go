package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/nats-io/nats.go/jetstream"
	"github.com/proxyhubb/control-api/internal/nats"
)

// TreasuryEventConsumer is a durable JetStream consumer for treasury events
// (topup, reconciliation). EV-01 remediation: the TREASURY stream previously had
// no consumer, so events accumulated unread and ops had no lag signal.
type TreasuryEventConsumer struct{}

func NewTreasuryEventConsumer() *TreasuryEventConsumer {
	return &TreasuryEventConsumer{}
}

// Start initiates the durable consumer loop on the TREASURY stream.
func (w *TreasuryEventConsumer) Start(ctx context.Context) error {
	if nats.JS == nil {
		return fmt.Errorf("NATS JetStream not initialized")
	}

	log.Printf("Treasury Event Consumer starting")

	// Recreate the pull subscription inside the supervised loop so NATS
	// reconnects / API restarts do not leave a dead Messages() iterator.
	GoSupervised("TreasuryEventConsumer", 5*time.Second, func() {
		consumer, err := nats.JS.CreateOrUpdateConsumer(ctx, "TREASURY", jetstream.ConsumerConfig{
			Durable:       "treasury-event-consumer",
			FilterSubject: "proxy.treasury.v1.>",
			AckPolicy:     jetstream.AckExplicitPolicy,
			MaxDeliver:    5,
			AckWait:       30 * time.Second,
		})
		if err != nil {
			log.Printf("TreasuryEventConsumer: create consumer failed: %v", err)
			return
		}

		iter, err := consumer.Messages()
		if err != nil {
			log.Printf("TreasuryEventConsumer: messages iterator failed: %v", err)
			return
		}
		defer iter.Stop()

		log.Printf("Treasury Event Consumer started")
		for {
			msg, err := iter.Next()
			if err != nil {
				log.Printf("TreasuryEventConsumer iterator error: %v — recreating", err)
				return
			}

			RunSafely("TreasuryEventConsumer.handle", func() {
				w.handle(ctx, msg)
			})
		}
	})

	return nil
}

func (w *TreasuryEventConsumer) handle(ctx context.Context, msg jetstream.Msg) {
	var event map[string]interface{}
	if err := json.Unmarshal(msg.Data(), &event); err != nil {
		log.Printf("TreasuryEventConsumer: malformed event on %s: %v", msg.Subject(), err)
		_ = msg.Term()
		return
	}

	subject := msg.Subject()
	marker, _ := event["marker"].(string)
	eventType, _ := event["type"].(string)
	if marker != "" {
		log.Printf("TreasuryEventConsumer: subject=%s type=%s marker=%s", subject, eventType, marker)
	} else {
		log.Printf("TreasuryEventConsumer: subject=%s type=%s event=%v", subject, eventType, event)
	}

	// Treasury events are observability/accounting signals. Processing is
	// intentionally side-effect-light: log for the audit trail and ack. Downstream
	// reconciliation/alerting can be layered here without changing producers.
	if err := msg.Ack(); err != nil {
		log.Printf("TreasuryEventConsumer: ack failed on %s: %v", subject, err)
	}
}

// TreasuryStreamInfo exposes TREASURY stream state for lag monitoring.
func TreasuryStreamInfo(ctx context.Context) (*jetstream.StreamInfo, error) {
	if nats.JS == nil {
		return nil, fmt.Errorf("JetStream not initialized")
	}
	stream, err := nats.JS.Stream(ctx, "TREASURY")
	if err != nil {
		return nil, err
	}
	return stream.Info(ctx)
}
