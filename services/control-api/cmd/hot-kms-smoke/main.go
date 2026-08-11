// Hot KMS SendSOL smoke (devnet). Run on GCE with ADC + USE_GCP_KMS_HOT env.
//
//	go run ./cmd/hot-kms-smoke
package main

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	goredis "github.com/redis/go-redis/v9"

	internalRedis "github.com/proxyhubb/control-api/internal/redis"
	"github.com/proxyhubb/control-api/internal/solana"
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	rpc := strings.TrimSpace(os.Getenv("SOLANA_RPC_URL"))
	if rpc == "" {
		rpc = "https://api.devnet.solana.com"
	}
	client, err := solana.NewOracleClient(solana.Config{
		RPCEndpoints:           []string{rpc},
		OracleKeypairPath:      strings.TrimSpace(os.Getenv("SOLANA_ORACLE_KEYPAIR")),
		TreasuryHotKeypairPath: strings.TrimSpace(os.Getenv("SOLANA_TREASURY_HOT_KEYPAIR")),
		Network:                "devnet",
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "NewOracleClient: %v\n", err)
		os.Exit(1)
	}

	redisURL := strings.TrimSpace(os.Getenv("REDIS_URL"))
	if redisURL == "" {
		fmt.Fprintln(os.Stderr, "REDIS_URL required for velocity guard")
		os.Exit(1)
	}
	opt, err := goredis.ParseURL(redisURL)
	if err != nil {
		fmt.Fprintf(os.Stderr, "redis parse: %v\n", err)
		os.Exit(1)
	}
	rdb := goredis.NewClient(opt)
	if err := rdb.Ping(ctx).Err(); err != nil {
		fmt.Fprintf(os.Stderr, "redis ping: %v\n", err)
		os.Exit(1)
	}
	var rc internalRedis.RedisClient = rdb
	client.SetVelocityGuard(solana.NewVelocityGuard(rc, nil))

	payout := client.GetPayoutPublicKey()
	fmt.Println("payout", payout.String())
	if !client.HasSeparateTreasuryHot() {
		fmt.Fprintln(os.Stderr, "FAIL: expected separate treasury hot")
		os.Exit(1)
	}

	sig, err := client.SendSOL(ctx, payout, 1000)
	if err != nil {
		fmt.Fprintf(os.Stderr, "SendSOL: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("sig", sig)
	fmt.Println("HOT_KMS_SENDSOL_OK")
}
