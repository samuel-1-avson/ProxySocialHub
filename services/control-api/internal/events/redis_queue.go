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

// Subscribe listens for events using Redis Streams + Consumer Groups so events
// are not lost when the consumer crashes (4.5).
//
// The consumer group is named after eventType; the consumer name defaults to
// "worker-1". Use SubscribeWithConsumerGroup for explicit group/consumer naming.
// Pub/Sub fanout is preserved in Publish for real-time subscribers.
func (q *RedisQueue) Subscribe(ctx context.Context, eventType EventType, handler func(Event) error) error {
	return q.SubscribeWithConsumerGroup(ctx, eventType,
		"cg:"+string(eventType), "worker-1", handler)
}

// SubscribeWithConsumerGroup reads from a Redis Stream using Consumer Groups.
// Each message is acknowledged (XACK) only after the handler returns nil,
// ensuring at-least-once delivery on crash/restart.
func (q *RedisQueue) SubscribeWithConsumerGroup(
	ctx context.Context,
	eventType EventType,
	groupName, consumerName string,
	handler func(Event) error,
) error {
	streamKey := q.prefix + string(eventType)

	// Create the consumer group (idempotent — MKSTREAM creates the stream too).
	if err := q.ensureConsumerGroup(ctx, streamKey, groupName); err != nil {
		return fmt.Errorf("failed to create consumer group %q: %w", groupName, err)
	}

	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			default:
			}

			msgs, err := q.client.XReadGroup(ctx, &redis.XReadGroupArgs{
				Group:    groupName,
				Consumer: consumerName,
				Streams:  []string{streamKey, ">"},
				Count:    10,
				Block:    5000, // ms — long-poll, releases goroutine when idle
			}).Result()
			if err != nil {
				if err == redis.Nil {
					continue // timeout, no messages — loop
				}
				log.Printf("RedisQueue: XReadGroup error on %s: %v", streamKey, err)
				continue
			}

			for _, stream := range msgs {
				for _, msg := range stream.Messages {
					rawData, ok := msg.Values["data"].(string)
					if !ok {
						// Malformed message — ack and skip to avoid redelivery loop.
						q.client.XAck(ctx, streamKey, groupName, msg.ID)
						continue
					}

					var event Event
					if err := json.Unmarshal([]byte(rawData), &event); err != nil {
						log.Printf("RedisQueue: unmarshal error for msg %s: %v", msg.ID, err)
						q.client.XAck(ctx, streamKey, groupName, msg.ID)
						continue
					}

					if err := handler(event); err != nil {
						// Handler failed — do NOT ack; message will be redelivered.
						log.Printf("RedisQueue: handler error for event %s: %v", event.ID, err)
						continue
					}

					// Acknowledge only after successful processing.
					if ackErr := q.client.XAck(ctx, streamKey, groupName, msg.ID).Err(); ackErr != nil {
						log.Printf("RedisQueue: XAck failed for msg %s: %v", msg.ID, ackErr)
					}
				}
			}
		}
	}()

	return nil
}

// ensureConsumerGroup creates the consumer group if it does not already exist.
// MKSTREAM creates the stream automatically when it does not exist yet.
func (q *RedisQueue) ensureConsumerGroup(ctx context.Context, streamKey, groupName string) error {
	err := q.client.XGroupCreateMkStream(ctx, streamKey, groupName, "0").Err()
	if err != nil && err.Error() != "BUSYGROUP Consumer Group name already exists" {
		return err
	}
	return nil
}

// Close closes the queue connection (nothing to close for Redis client as it's shared)
func (q *RedisQueue) Close() error {
	return nil
}
