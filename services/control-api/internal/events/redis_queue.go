package events

import (
	"context"
	"encoding/json"
	"fmt"
	"log"

	"github.com/redis/go-redis/v9"
)

// RedisQueue implements EventQueue using Redis Pub/Sub and Streams
type RedisQueue struct {
	client *redis.Client
	prefix string
}

// NewRedisQueue creates a new RedisQueue
func NewRedisQueue(client *redis.Client) *RedisQueue {
	return &RedisQueue{
		client: client,
		prefix: "events:",
	}
}

// Publish sends an event to Redis Stream
func (q *RedisQueue) Publish(ctx context.Context, event Event) error {
	data, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("failed to marshal event: %w", err)
	}

	// Use Redis Streams for reliable messaging
	// Key: events:{type}
	streamKey := q.prefix + string(event.Type)

	cmd := q.client.XAdd(ctx, &redis.XAddArgs{
		Stream: streamKey,
		Values: map[string]interface{}{
			"data": data,
		},
	})

	if cmd.Err() != nil {
		return fmt.Errorf("failed to publish event to stream: %w", cmd.Err())
	}

	// Also Publish to Pub/Sub for real-time subscribers (fire-and-forget)
	pubsubKey := q.prefix + "pubsub:" + string(event.Type)
	q.client.Publish(ctx, pubsubKey, data)

	return nil
}

// Subscribe listens for events of a specific type using Pub/Sub (for now, simpler than Consumer Groups)
// TODO: Upgrade to Consumer Groups for persistent background workers
func (q *RedisQueue) Subscribe(ctx context.Context, eventType EventType, handler func(Event) error) error {
	pubsubKey := q.prefix + "pubsub:" + string(eventType)
	pubsub := q.client.Subscribe(ctx, pubsubKey)

	// Wait for confirmation that subscription is created
	_, err := pubsub.Receive(ctx)
	if err != nil {
		return err
	}

	// Start processing in background goroutine
	go func() {
		defer pubsub.Close()
		ch := pubsub.Channel()

		for msg := range ch {
			var event Event
			if err := json.Unmarshal([]byte(msg.Payload), &event); err != nil {
				log.Printf("Error unmarshaling event: %v", err)
				continue
			}

			if err := handler(event); err != nil {
				log.Printf("Error handling event %s: %v", event.ID, err)
			}
		}
	}()

	return nil
}

// Close closes the queue connection (nothing to close for Redis client as it's shared)
func (q *RedisQueue) Close() error {
	return nil
}
