package decentralization

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// MoneyCaps is the single source for outflow caps (W-27). Before this,
// the velocity guard (50 SOL single), the withdraw API binding
// (10_000 SOL) and the watchtower (100 SOL/hr) each invented numbers, so
// large legitimate withdrawals debited users and only then hit the
// guard. All three now derive from here and are validated at boot.
type Caps struct {
	MaxSingleTransferSOL float64 // per on-chain transfer (velocity guard)
	MaxHourlyOutflowSOL  float64 // rolling hourly outflow (velocity guard)
	WithdrawAPICapSOL    float64 // per-withdrawal API cap (pre-debit)
}

func envFloat(key string, def float64) (float64, error) {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return def, nil
	}
	v, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return 0, fmt.Errorf("%s=%q is not a number", key, raw)
	}
	return v, nil
}

// MoneyCaps resolves the caps. WithdrawAPICapSOL defaults to the
// single-transfer cap so the API never promises what the chain guard
// will reject after debit.
func MoneyCaps() (Caps, error) {
	single, err := envFloat("ORACLE_MAX_SINGLE_TRANSFER_SOL", 50)
	if err != nil {
		return Caps{}, err
	}
	hourly, err := envFloat("ORACLE_MAX_HOURLY_OUTFLOW_SOL", 500)
	if err != nil {
		return Caps{}, err
	}
	withdraw, err := envFloat("WITHDRAW_API_CAP_SOL", single)
	if err != nil {
		return Caps{}, err
	}
	caps := Caps{MaxSingleTransferSOL: single, MaxHourlyOutflowSOL: hourly, WithdrawAPICapSOL: withdraw}
	if err := caps.Validate(); err != nil {
		return Caps{}, err
	}
	return caps, nil
}

// Validate enforces cap coherence (boot gate, W-27).
func (c Caps) Validate() error {
	if c.MaxSingleTransferSOL <= 0 {
		return fmt.Errorf("ORACLE_MAX_SINGLE_TRANSFER_SOL must be > 0")
	}
	if c.MaxHourlyOutflowSOL < c.MaxSingleTransferSOL {
		return fmt.Errorf("ORACLE_MAX_HOURLY_OUTFLOW_SOL (%.2f) must be >= ORACLE_MAX_SINGLE_TRANSFER_SOL (%.2f)", c.MaxHourlyOutflowSOL, c.MaxSingleTransferSOL)
	}
	if c.WithdrawAPICapSOL <= 0 {
		return fmt.Errorf("WITHDRAW_API_CAP_SOL must be > 0")
	}
	if c.WithdrawAPICapSOL > c.MaxSingleTransferSOL {
		return fmt.Errorf("WITHDRAW_API_CAP_SOL (%.2f) exceeds ORACLE_MAX_SINGLE_TRANSFER_SOL (%.2f): the API would accept withdrawals the velocity guard rejects after debit", c.WithdrawAPICapSOL, c.MaxSingleTransferSOL)
	}
	return nil
}
