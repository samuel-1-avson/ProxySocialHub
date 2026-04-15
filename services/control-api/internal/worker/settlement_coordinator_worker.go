package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/nats-io/nats.go/jetstream"
	"github.com/proxyhubb/control-api/internal/nats"
	"github.com/proxyhubb/control-api/internal/settlement"
)

type SettlementCoordinatorWorker struct {
	coordinator *settlement.Coordinator
}

func NewSettlementCoordinatorWorker() *SettlementCoordinatorWorker {
	return &SettlementCoordinatorWorker{
		coordinator: settlement.NewCoordinator(nil),
	}
}

func (w *SettlementCoordinatorWorker) Start(ctx context.Context) error {
	if nats.JS == nil {
		return fmt.Errorf("NATS JetStream not initialized")
	}

	consumer, err := nats.JS.CreateOrUpdateConsumer(ctx, "SETTLEMENT", jetstream.ConsumerConfig{
		Durable:       "settlement-coordinator-worker",
		FilterSubject: settlement.ReceiptCreatedSubject,
	})
	if err != nil {
		return fmt.Errorf("failed to create settlement consumer: %w", err)
	}

	iter, err := consumer.Messages()
	if err != nil {
		return err
	}

	log.Printf("Settlement coordinator worker started")

	GoSupervised("SettlementCoordinatorWorker", 5*time.Second, func() {
		for {
			msg, err := iter.Next()
			if err != nil {
				log.Printf("SettlementCoordinatorWorker error: %v", err)
				time.Sleep(1 * time.Second)
				continue
			}

			RunSafely("SettlementCoordinatorWorker.receipt", func() {
				w.handleReceiptCreated(ctx, msg)
			})
		}
	})

	return nil
}

func (w *SettlementCoordinatorWorker) handleReceiptCreated(ctx context.Context, msg jetstream.Msg) {
	var event settlement.ReceiptCreatedEvent
	if err := json.Unmarshal(msg.Data(), &event); err != nil {
		msg.Term()
		return
	}

	receiptID := event.ReceiptID
	if receiptID == uuid.Nil {
		msg.Term()
		return
	}

	if err := w.coordinator.ProcessReceipt(ctx, receiptID); err != nil {
		log.Printf("SettlementCoordinatorWorker failed for receipt %s: %v", receiptID, err)
		msg.Nak()
		return
	}

	msg.Ack()
}
