package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/nats-io/nats.go/jetstream"
	"github.com/proxyhubb/control-api/internal/core/domain"
	"github.com/proxyhubb/control-api/internal/core/ports"
	"github.com/proxyhubb/control-api/internal/nats"
)

type ProvisioningWorker struct {
	sessionRepo ports.SessionRepository
	gateway     ports.ProxyGateway
}

func NewProvisioningWorker(repo ports.SessionRepository, gateway ports.ProxyGateway) *ProvisioningWorker {
	return &ProvisioningWorker{
		sessionRepo: repo,
		gateway:     gateway,
	}
}

// Start initiates the durable consumer loop
func (w *ProvisioningWorker) Start(ctx context.Context) error {
	if nats.JS == nil {
		return fmt.Errorf("NATS JetStream not initialized")
	}

	consumer, err := nats.JS.CreateOrUpdateConsumer(ctx, "SESSIONS", jetstream.ConsumerConfig{
		Durable:       "provisioning-worker",
		FilterSubject: "proxy.sessions.v1.>",
	})
	if err != nil {
		return fmt.Errorf("failed to create consumer: %w", err)
	}

	iter, err := consumer.Messages()
	if err != nil {
		return err
	}

	log.Printf("Session Provisioning Worker started")

	go func() {
		for {
			msg, err := iter.Next()
			if err != nil {
				log.Printf("Worker error: %v", err)
				time.Sleep(1 * time.Second)
				continue
			}

			// Handle based on subject
			subject := msg.Subject()
			switch subject {
			case "proxy.sessions.v1.created":
				w.handleCreated(ctx, msg)
			case "proxy.sessions.v1.terminated":
				w.handleTerminated(ctx, msg)
			}
		}
	}()

	return nil
}

func (w *ProvisioningWorker) handleCreated(ctx context.Context, msg jetstream.Msg) {
	var event domain.SessionCreatedEvent
	if err := json.Unmarshal(msg.Data(), &event); err != nil {
		log.Printf("Malformed event: %v", err)
		msg.Term() // Kill the message
		return
	}

	log.Printf("[Provisioner] Provisioning session %s...", event.SessionID)

	// Fetch session from DB to get credentials
	session, err := w.sessionRepo.GetSessionByID(ctx, event.SessionID)
	if err != nil {
		log.Printf("[Provisioner] Failed to fetch session %s: %v", event.SessionID, err)
		msg.Nak()
		return
	}

	// Provision on the edge gateway (writes to Redis)
	if err := w.gateway.ProvisionSession(ctx, session); err != nil {
		log.Printf("[Provisioner] Gateway provisioning failed for %s: %v", event.SessionID, err)
		msg.Nak()
		return
	}

	// Update DB to Active
	err = w.sessionRepo.UpdateSessionStatus(ctx, event.SessionID, domain.SessionActive)
	if err != nil {
		log.Printf("Failed to activate session %s: %v", event.SessionID, err)
		msg.Nak() // Retry later
		return
	}

	msg.Ack()
	log.Printf("[Provisioner] Session %s activated successfully", event.SessionID)
}

func (w *ProvisioningWorker) handleTerminated(ctx context.Context, msg jetstream.Msg) {
	var event domain.SessionTerminatedEvent
	if err := json.Unmarshal(msg.Data(), &event); err != nil {
		msg.Term()
		return
	}

	log.Printf("[Provisioner] Tearing down session %s...", event.SessionID)

	// Tear down on the edge gateway (removes from Redis)
	if err := w.gateway.TerminateSession(ctx, event.SessionID); err != nil {
		log.Printf("[Provisioner] Gateway teardown failed for %s: %v", event.SessionID, err)
	}

	// Update DB to Completed
	_ = w.sessionRepo.UpdateSessionStatus(ctx, event.SessionID, domain.SessionCompleted)

	msg.Ack()
}
