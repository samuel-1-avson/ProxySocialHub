package worker

import (
	"testing"
	"time"

	"github.com/proxyhubb/control-api/internal/models"
)

func TestShouldCancelUnfundedPending(t *testing.T) {
	timeout := 2 * time.Hour
	old := 3 * time.Hour
	young := 30 * time.Minute

	cases := []struct {
		name     string
		status   models.OrderStatus
		fetchErr string
		age      time.Duration
		want     bool
	}{
		{
			name:     "not found and old pending_payment",
			status:   models.OrderStatusPendingPayment,
			fetchErr: "escrow account not found",
			age:      old,
			want:     true,
		},
		{
			name:     "empty PDA treated as missing",
			status:   models.OrderStatusPendingPayment,
			fetchErr: "",
			age:      old,
			want:     true,
		},
		{
			name:     "rpc 429 must not cancel",
			status:   models.OrderStatusPendingPayment,
			fetchErr: "failed to fetch escrow account: 429 Too Many Requests",
			age:      old,
			want:     false,
		},
		{
			name:     "generic fetch failure must not cancel",
			status:   models.OrderStatusPendingPayment,
			fetchErr: "failed to fetch escrow account: context deadline exceeded",
			age:      old,
			want:     false,
		},
		{
			name:     "young order waits",
			status:   models.OrderStatusPendingPayment,
			fetchErr: "escrow account not found",
			age:      young,
			want:     false,
		},
		{
			name:     "active funded orders are not cancelled this way",
			status:   models.OrderStatusActive,
			fetchErr: "escrow account not found",
			age:      old,
			want:     false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := shouldCancelUnfundedPending(tc.status, tc.fetchErr, tc.age, timeout)
			if got != tc.want {
				t.Fatalf("shouldCancelUnfundedPending(%q, %q, %s) = %v, want %v",
					tc.status, tc.fetchErr, tc.age, got, tc.want)
			}
		})
	}
}

func TestUnfundedEscrowTimeoutDefault(t *testing.T) {
	t.Setenv("PROXYHUB_UNFUNDED_ESCROW_TIMEOUT", "")
	if got := unfundedEscrowTimeout(); got != defaultUnfundedEscrowTimeout {
		t.Fatalf("default timeout = %s, want %s", got, defaultUnfundedEscrowTimeout)
	}
	t.Setenv("PROXYHUB_UNFUNDED_ESCROW_TIMEOUT", "45m")
	if got := unfundedEscrowTimeout(); got != 45*time.Minute {
		t.Fatalf("env timeout = %s, want 45m", got)
	}
}
