package solana

import (
	"context"
	"testing"

	"github.com/proxyhubb/control-api/internal/redis"
	"github.com/proxyhubb/control-api/internal/testutil"
)

// W-27: Check reserves; Release returns budget after a definite failure.
// Old behaviour burned the hourly budget on transfers that never left.
func TestVelocityGuard_P1_ReleaseRestoresBudget(t *testing.T) {
	testutil.SetupTestRedis(t)
	t.Setenv("ORACLE_MAX_SINGLE_TRANSFER_SOL", "50")
	t.Setenv("ORACLE_MAX_HOURLY_OUTFLOW_SOL", "60")
	ctx := context.Background()
	redis.Client.Del(ctx, VelocityOutflowKey(), velocityFreezeKey)

	g := NewVelocityGuard(redis.Client, nil)
	if err := g.Check(ctx, 50); err != nil {
		t.Fatalf("first reserve: %v", err)
	}
	if err := g.Check(ctx, 50); err == nil {
		t.Fatal("second reserve must exceed hourly cap")
	}
	g.Release(ctx, 50) // first send definitively failed
	if err := g.Check(ctx, 50); err != nil {
		t.Fatalf("reserve after release: %v", err)
	}
	// Over-release floors at zero, never negative budget creation.
	g.Release(ctx, 10_000)
	total, err := redis.Client.Get(ctx, VelocityOutflowKey()).Float64()
	if err != nil {
		t.Fatal(err)
	}
	if total != 0 {
		t.Fatalf("release floor: got %v, want 0", total)
	}
}
