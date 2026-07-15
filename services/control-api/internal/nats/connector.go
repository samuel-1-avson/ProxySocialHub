package nats

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
)

var (
	Conn *nats.Conn
	JS   jetstream.JetStream
)

// Init initializes the NATS connection and JetStream context
func Init() error {
	natsURL := os.Getenv("NATS_URL")
	if natsURL == "" {
		natsURL = nats.DefaultURL
	}

	nc, err := nats.Connect(natsURL,
		nats.MaxReconnects(5),
		nats.ReconnectWait(2*time.Second),
		nats.Name("ProxyHub_ControlAPI"),
	)
	if err != nil {
		return fmt.Errorf("failed to connect to NATS: %w", err)
	}

	// Initialize JetStream
	js, err := jetstream.New(nc)
	if err != nil {
		return fmt.Errorf("failed to initialize JetStream: %w", err)
	}

	// Create persistent streams
	streams := []struct {
		name     string
		subjects []string
		maxAge   time.Duration
		maxBytes int64
	}{
		{name: "SESSIONS", subjects: []string{"proxy.sessions.v1.>"}, maxAge: 7 * 24 * time.Hour, maxBytes: 500 * 1024 * 1024},
		{name: "SETTLEMENT", subjects: []string{"proxy.settlement.v1.>"}, maxAge: 30 * 24 * time.Hour, maxBytes: 500 * 1024 * 1024},
		{name: "TELEMETRY", subjects: []string{"proxy.telemetry.v1.>"}, maxAge: 24 * time.Hour, maxBytes: 1024 * 1024 * 1024},
		{name: "MESSAGING", subjects: []string{"proxy.messaging.v1.>"}, maxAge: 14 * 24 * time.Hour, maxBytes: 500 * 1024 * 1024},
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	for _, s := range streams {
		_, err = js.CreateOrUpdateStream(ctx, jetstream.StreamConfig{
			Name:     s.name,
			Subjects: s.subjects,
			Storage:  jetstream.FileStorage,
			MaxAge:   s.maxAge,
			MaxBytes: s.maxBytes,
			Discard:  jetstream.DiscardOld,
		})
		if err != nil {
			return fmt.Errorf("failed to create JetStream stream %s: %w", s.name, err)
		}
	}

	log.Printf("Successfully connected to NATS and initialized streams")

	Conn = nc
	JS = js

	return nil
}

// GetStreamInfo returns information about the SESSIONS stream
func GetStreamInfo(ctx context.Context) (*jetstream.StreamInfo, error) {
	if JS == nil {
		return nil, fmt.Errorf("JetStream not initialized")
	}
	stream, err := JS.Stream(ctx, "SESSIONS")
	if err != nil {
		return nil, err
	}
	return stream.Info(ctx)
}

// Close closes the NATS connection
func Close() {
	if Conn != nil {
		Conn.Close()
	}
}

// Publish serializes and sends an event to the specified NATS subject
func Publish(ctx context.Context, subject string, data interface{}) error {
	if JS == nil {
		return fmt.Errorf("JetStream not initialized")
	}

	jsonData, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("failed to marshal event: %w", err)
	}

	_, err = JS.Publish(ctx, subject, jsonData)
	return err
}
