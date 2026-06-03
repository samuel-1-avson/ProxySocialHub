// p3_seed_redis writes a raw Redis string key (used by P3 multipod E2E on Windows).
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/redis/go-redis/v9"
)

func main() {
	redisURL := flag.String("redis", "redis://127.0.0.1:26379", "Redis URL (P3 compose publishes :26379)")
	key := flag.String("key", "", "Redis key (required)")
	file := flag.String("file", "", "File whose contents become the value (required)")
	ttl := flag.Int("ttl", 3600, "TTL seconds")
	flag.Parse()

	if *key == "" || *file == "" {
		fmt.Fprintln(os.Stderr, "usage: p3_seed_redis -key session:user -file payload.json [-redis URL] [-ttl SECS]")
		os.Exit(2)
	}

	payload, err := os.ReadFile(*file)
	if err != nil {
		fmt.Fprintf(os.Stderr, "read file: %v\n", err)
		os.Exit(1)
	}

	opt, err := redis.ParseURL(*redisURL)
	if err != nil {
		fmt.Fprintf(os.Stderr, "parse redis url: %v\n", err)
		os.Exit(1)
	}
	rdb := redis.NewClient(opt)
	defer rdb.Close()

	ctx := context.Background()
	if err := rdb.Set(ctx, *key, payload, time.Duration(*ttl)*time.Second).Err(); err != nil {
		fmt.Fprintf(os.Stderr, "redis set: %v\n", err)
		os.Exit(1)
	}

	got, err := rdb.Get(ctx, *key).Result()
	if err != nil || len(got) == 0 {
		fmt.Fprintf(os.Stderr, "verify get: %v (len=%d)\n", err, len(got))
		os.Exit(1)
	}
	fmt.Printf("OK %s (%d bytes)\n", *key, len(got))
}
