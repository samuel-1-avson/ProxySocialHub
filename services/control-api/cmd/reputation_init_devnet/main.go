// Initialize reputation program config on Solana (Wave 4.2 post-deploy).
//
//	SOLANA_ORACLE_KEYPAIR=./infra/oracle-keypair.json \
//	SOLANA_RPC_URL=https://api.devnet.solana.com \
//	go run ./cmd/reputation_init_devnet
package main

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/proxyhubb/control-api/internal/solana"
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	rpc := strings.TrimSpace(os.Getenv("SOLANA_RPC_URL"))
	if rpc == "" {
		rpc = "https://api.devnet.solana.com"
	}
	kp := strings.TrimSpace(os.Getenv("SOLANA_ORACLE_KEYPAIR"))
	if kp == "" {
		kp = "F:/project/proxyhubb/infra/oracle-keypair.json"
	}
	_ = os.Setenv("REPUTATION_PROGRAM_ID", solana.DefaultReputationProgramID)

	client, err := solana.NewOracleClient(solana.Config{
		RPCEndpoints:      []string{rpc},
		OracleKeypairPath: kp,
		Network:           "devnet",
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "NewOracleClient: %v\n", err)
		os.Exit(1)
	}

	admin := client.GetOraclePublicKey()
	fmt.Println("admin", admin.String())
	fmt.Println("reputation_program", solana.ReputationProgramID())
	cfgPDA, _, err := solana.GetReputationOracleConfigPDA()
	if err != nil {
		fmt.Fprintf(os.Stderr, "config PDA: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("oracle_config_pda", cfgPDA.String())

	initSig, err := client.InitializeReputationConfig(ctx, admin)
	if err != nil {
		// Idempotent: already initialized is OK — continue to set_deploy_allowed.
		fmt.Fprintf(os.Stderr, "initialize_config: %v\n", err)
	} else {
		fmt.Println("initialize_config_sig", initSig)
		// Wait for PDA rent/init to finalize before set_deploy_allowed.
		time.Sleep(8 * time.Second)
	}

	allowSig, err := client.SetReputationDeployAllowed(ctx, true)
	if err != nil {
		fmt.Fprintf(os.Stderr, "set_deploy_allowed: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("set_deploy_allowed_sig", allowSig)
	fmt.Println("REPUTATION_INIT_OK")
}
