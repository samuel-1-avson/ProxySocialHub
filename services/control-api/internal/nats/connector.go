package nats

import (
	"context"
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

	// Create persistent stream if not exists
	streamName := "SESSIONS"
	subjects := []string{"proxy.sessions.v1.>"}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	_, err = js.CreateOrUpdateStream(ctx, jetstream.StreamConfig{
		Name:     streamName,
		Subjects: subjects,
		Storage:  jetstream.FileStorage,
	})
	if err != nil {
		return fmt.Errorf("failed to create JetStream stream: %w", err)
	}

	log.Printf("Successfully connected to NATS and initialized stream %s", streamName)

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
