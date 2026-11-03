// custody-check verifies configured KMS encryption and recovery without wallets.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/proxyhubb/control-api/internal/custody"
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	k, err := custody.DefaultKEK()
	if err == nil {
		err = custody.Probe(ctx, k)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "custody readiness failed:", err)
		os.Exit(1)
	}
	json.NewEncoder(os.Stdout).Encode(map[string]any{"ready": true, "key_id": k.ID(), "check": "synthetic DEK wrap and recovery; no wallet or funds"})
}
