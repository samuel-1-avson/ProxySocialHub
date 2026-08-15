// Live smoke: Groth16 settle → VerifyUsage with ZKBatchPDA → read reputation score.
//
//	GROTH16_PROVER_URL=http://127.0.0.1:8096 \
//	SOLANA_ORACLE_KEYPAIR=... \
//	go run ./cmd/reputation_credit_e2e
package main

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"os"
	"strings"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"

	"github.com/proxyhubb/control-api/internal/solana"
	"github.com/proxyhubb/control-api/internal/zk"
)

func main() {
	_ = os.Setenv("PROXYHUB_ZK_ONCHAIN_GROTH16_READY", "true")
	_ = os.Setenv("PROXYHUB_ZK_ONCHAIN_GROTH16", "true")

	ctx, cancel := context.WithTimeout(context.Background(), 240*time.Second)
	defer cancel()

	rpcURL := strings.TrimSpace(os.Getenv("SOLANA_RPC_URL"))
	if rpcURL == "" {
		rpcURL = "https://api.devnet.solana.com"
	}
	kp := strings.TrimSpace(os.Getenv("SOLANA_ORACLE_KEYPAIR"))
	if kp == "" {
		kp = "/keypair/oracle-keypair.json"
	}
	client, err := solana.NewOracleClient(solana.Config{
		RPCEndpoints:      []string{rpcURL},
		OracleKeypairPath: kp,
		Network:           "devnet",
	})
	if err != nil {
		fatalf("NewOracleClient: %v", err)
	}

	proverURL := strings.TrimRight(strings.TrimSpace(os.Getenv("GROTH16_PROVER_URL")), "/")
	if proverURL == "" {
		fatalf("GROTH16_PROVER_URL required")
	}

	var root [32]byte
	if _, err := rand.Read(root[:]); err != nil {
		fatalf("rand: %v", err)
	}
	var leaf [32]byte
	if _, err := rand.Read(leaf[:]); err != nil {
		fatalf("rand leaf: %v", err)
	}
	sessions := uint32(1)
	totalBytes := uint64(1234)
	periodStart := int64(1720000000)
	periodEnd := int64(1720003600)
	leavesHash, err := zk.LeavesHash([][32]byte{leaf})
	if err != nil {
		fatalf("leaves_hash: %v", err)
	}

	gclient := zk.NewGroth16Client(proverURL, 60*time.Second, true)
	proof, err := gclient.ProveBatchHeader(ctx, &zk.BatchProof{
		Root:         root,
		LeafHashes:   [][32]byte{leaf},
		SessionCount: sessions,
		TotalBytes:   totalBytes,
		PeriodStart:  periodStart,
		PeriodEnd:    periodEnd,
	})
	if err != nil {
		fatalf("prove: %v", err)
	}
	proofHash := solana.ProofHashFromBytes(proof[:])
	fmt.Printf("proved root=%s leaves_hash=%s proof_hash=%s\n",
		hex.EncodeToString(root[:]), hex.EncodeToString(leavesHash[:]), hex.EncodeToString(proofHash[:]))

	sig, batchPDA, err := client.SubmitZKBatchGroth16(ctx, solana.ZKBatchGroth16Params{
		ZKBatchParams: solana.ZKBatchParams{
			BatchRoot:    root,
			SessionCount: sessions,
			TotalBytes:   totalBytes,
			PeriodStart:  periodStart,
			PeriodEnd:    periodEnd,
			ProofHash:    proofHash,
		},
		LeavesHash: leavesHash,
		Proof:      proof,
	})
	if err != nil {
		fatalf("SubmitZKBatchGroth16: %v", err)
	}
	fmt.Printf("settled sig=%s batch_pda=%s\n", sig, batchPDA)

	provider := client.GetOraclePublicKey()
	rpcClient := rpc.New(rpcURL)

	// Confirm ZKBatchPDA is proxyhub-owned (Finalized) before verify_usage.
	deadline := time.Now().Add(90 * time.Second)
	for {
		info, e := rpcClient.GetAccountInfoWithOpts(ctx, batchPDA, &rpc.GetAccountInfoOpts{
			Commitment: rpc.CommitmentFinalized,
		})
		if e == nil && info != nil && info.Value != nil {
			fmt.Printf("batch_pda owner=%s lamports=%d data_len=%d\n",
				info.Value.Owner, info.Value.Lamports, len(info.Value.Data.GetBinary()))
			if info.Value.Owner.String() == "AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu" {
				break
			}
		}
		if time.Now().After(deadline) {
			fatalf("ZKBatchPDA not proxyhub-owned (finalized) before credit")
		}
		time.Sleep(750 * time.Millisecond)
	}

	before, beforeOK := readScore(ctx, rpcClient, provider)
	if beforeOK {
		fmt.Printf("score_before=%d\n", before)
	} else {
		fmt.Printf("score_before=absent\n")
	}

	creditSigs, err := client.CreditProvidersFromZKBatchWithPDA(ctx, root, proofHash, batchPDA, []solana.ProviderBatchCredit{
		{Wallet: provider.String(), TotalBytes: totalBytes},
	})
	if err != nil {
		fatalf("CreditProvidersFromZKBatch: %v (partial=%v)", err, creditSigs)
	}
	fmt.Printf("credit_sigs=%v\n", creditSigs)

	// Wait until score moves (SendTransaction returns before confirmation).
	deadlineScore := time.Now().Add(90 * time.Second)
	var after uint64
	var afterOK bool
	for {
		after, afterOK = readScore(ctx, rpcClient, provider)
		if afterOK {
			fmt.Printf("score_poll=%d\n", after)
			if !beforeOK || after > before {
				break
			}
		}
		if time.Now().After(deadlineScore) {
			break
		}
		time.Sleep(1 * time.Second)
	}
	if !afterOK {
		fatalf("score_after missing")
	}
	fmt.Printf("score_after=%d\n", after)
	if beforeOK {
		if after <= before {
			fatalf("score did not increase: before=%d after=%d", before, after)
		}
	} else if after < 101 {
		// New PDA: init 100 + verify_usage +1
		fatalf("expected init+credit score>=101, got %d", after)
	}
	fmt.Printf("OK reputation_credit_e2e provider=%s score=%d\n", provider, after)
}

func readScore(ctx context.Context, client *rpc.Client, provider sol.PublicKey) (uint64, bool) {
	pda, _, err := solana.GetProviderReputationPDA(provider)
	if err != nil {
		return 0, false
	}
	info, err := client.GetAccountInfoWithOpts(ctx, pda, &rpc.GetAccountInfoOpts{
		Commitment: rpc.CommitmentConfirmed,
	})
	if err != nil || info == nil || info.Value == nil {
		return 0, false
	}
	data := info.Value.Data.GetBinary()
	if len(data) < 8+32+8 {
		return 0, false
	}
	return binary.LittleEndian.Uint64(data[40:48]), true
}

func fatalf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}
