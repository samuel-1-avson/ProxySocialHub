// Live BC-11-B e2e: submit_zk_batch_groth16.
//
// Default: baked sample proof (root 0x11…).
// With GROTH16_PROVER_URL set: prove a unique root via the BN254 prover, then submit.
//
//	PROXYHUB_ZK_ONCHAIN_GROTH16_READY=true \
//	GROTH16_PROVER_URL=http://127.0.0.1:8096 \
//	SOLANA_ORACLE_KEYPAIR=./infra/oracle-keypair.json \
//	go run ./cmd/groth16_batch_e2e
package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/proxyhubb/control-api/internal/solana"
)

func main() {
	_ = os.Setenv("PROXYHUB_ZK_ONCHAIN_GROTH16_READY", "true")
	_ = os.Setenv("PROXYHUB_ZK_ONCHAIN_GROTH16", "true")

	ctx, cancel := context.WithTimeout(context.Background(), 180*time.Second)
	defer cancel()

	rpc := strings.TrimSpace(os.Getenv("SOLANA_RPC_URL"))
	if rpc == "" {
		rpc = "https://api.devnet.solana.com"
	}
	kp := strings.TrimSpace(os.Getenv("SOLANA_ORACLE_KEYPAIR"))
	if kp == "" {
		kp = "F:/project/proxyhubb/infra/oracle-keypair.json"
	}
	programID := strings.TrimSpace(os.Getenv("SOLANA_PROGRAM_ID"))
	if programID == "" {
		programID = "AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu"
	}
	_ = programID

	client, err := solana.NewOracleClient(solana.Config{
		RPCEndpoints:      []string{rpc},
		OracleKeypairPath: kp,
		Network:           "devnet",
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "NewOracleClient: %v\n", err)
		os.Exit(1)
	}

	var root, leavesHash [32]byte
	var proof [256]byte
	sessionCount := uint32(3)
	totalBytes := uint64(1000)
	periodStart := int64(1)
	periodEnd := int64(2)

	proverURL := strings.TrimRight(strings.TrimSpace(os.Getenv("GROTH16_PROVER_URL")), "/")
	if proverURL != "" {
		if _, err := rand.Read(root[:]); err != nil {
			fmt.Fprintf(os.Stderr, "rand root: %v\n", err)
			os.Exit(1)
		}
		if _, err := rand.Read(leavesHash[:]); err != nil {
			fmt.Fprintf(os.Stderr, "rand leaves_hash: %v\n", err)
			os.Exit(1)
		}
		sessionCount = 2
		totalBytes = 777
		periodStart = 1710000000
		periodEnd = 1710003600
		proof, err = proveViaHTTP(ctx, proverURL, root, leavesHash, sessionCount, totalBytes, periodStart, periodEnd)
		if err != nil {
			fmt.Fprintf(os.Stderr, "prove: %v\n", err)
			os.Exit(1)
		}
		fmt.Printf("proved root=%s leaves=%s via %s\n",
			hex.EncodeToString(root[:]), hex.EncodeToString(leavesHash[:]), proverURL)
	} else {
		for i := range root {
			root[i] = 0x11
		}
		for i := range leavesHash {
			leavesHash[i] = 0x22
		}
		proof = sampleProof()
	}

	params := solana.ZKBatchGroth16Params{
		ZKBatchParams: solana.ZKBatchParams{
			BatchRoot:    root,
			SessionCount: sessionCount,
			TotalBytes:   totalBytes,
			PeriodStart:  periodStart,
			PeriodEnd:    periodEnd,
			ProofHash:    solana.ProofHashFromBytes(proof[:]),
		},
		LeavesHash: leavesHash,
		Proof:      proof,
	}

	sig, pda, err := client.SubmitZKBatchGroth16(ctx, params)
	if err != nil {
		fmt.Fprintf(os.Stderr, "SubmitZKBatchGroth16: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("OK sig=%s batch_pda=%s vk=%s\n", sig, pda, solana.BatchGroth16VKHashHex)
}

func proveViaHTTP(ctx context.Context, base string, root, leaves [32]byte, sessions uint32, bytesN uint64, start, end int64) ([256]byte, error) {
	var out [256]byte
	body, _ := json.Marshal(map[string]any{
		"batch_root":    hex.EncodeToString(root[:]),
		"session_count": sessions,
		"total_bytes":   bytesN,
		"period_start":  start,
		"period_end":    end,
		"leaves_hash":   hex.EncodeToString(leaves[:]),
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/v1/prove/batch-groth16", bytes.NewReader(body))
	if err != nil {
		return out, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return out, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return out, fmt.Errorf("prover %d: %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	var parsed struct {
		ProofBase64 string `json:"proof_base64"`
		VKHashHex   string `json:"vk_hash_hex"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return out, err
	}
	if vh := strings.ToLower(strings.TrimSpace(parsed.VKHashHex)); vh != "" && vh != solana.BatchGroth16VKHashHex {
		return out, fmt.Errorf("vk_hash mismatch %s", vh)
	}
	proofBytes, err := base64.StdEncoding.DecodeString(parsed.ProofBase64)
	if err != nil {
		return out, err
	}
	if len(proofBytes) != 256 {
		return out, fmt.Errorf("proof len %d", len(proofBytes))
	}
	copy(out[:], proofBytes)
	return out, nil
}

func sampleProof() [256]byte {
	// From programs/proxyhub/src/groth16_vk_generated.rs (gen-batch-vk digest-v2).
	a := []byte{
		12, 37, 140, 107, 145, 140, 80, 84, 217, 52, 19, 86, 201, 118, 128, 111, 27, 151, 37, 28, 35, 178, 34, 142, 229, 138, 42, 99, 232, 13, 233, 206, 159, 126, 252, 216, 28, 255, 57, 142, 38, 24, 215, 231, 25, 89, 234, 191, 75, 129, 87, 163, 30, 78, 157, 211, 171, 215, 140, 54, 111, 184, 111, 99,
	}
	b := []byte{
		20, 190, 191, 88, 14, 199, 163, 179, 71, 95, 207, 70, 56, 214, 208, 105, 63, 7, 240, 93, 2, 134, 122, 105, 191, 114, 21, 49, 58, 231, 49, 203, 38, 9, 32, 195, 58, 142, 186, 208, 65, 41, 81, 171, 147, 252, 213, 188, 255, 246, 22, 6, 0, 13, 15, 50, 161, 41, 205, 1, 179, 100, 67, 82, 24, 3, 111, 42, 27, 17, 23, 62, 6, 169, 42, 247, 42, 38, 85, 141, 148, 95, 190, 226, 11, 53, 25, 107, 39, 62, 69, 16, 31, 171, 100, 126, 25, 174, 47, 143, 99, 185, 250, 241, 130, 4, 7, 20, 118, 181, 20, 40, 79, 139, 26, 172, 110, 238, 241, 110, 54, 229, 59, 229, 177, 241, 77, 156,
	}
	c := []byte{
		22, 219, 110, 202, 212, 153, 92, 93, 183, 82, 3, 98, 1, 145, 95, 41, 101, 157, 215, 141, 239, 239, 148, 239, 138, 41, 53, 181, 253, 36, 139, 158, 168, 72, 37, 115, 234, 145, 74, 228, 11, 45, 12, 2, 76, 43, 27, 254, 168, 195, 145, 60, 60, 239, 233, 44, 121, 166, 53, 166, 143, 4, 137, 145,
	}
	var out [256]byte
	copy(out[0:64], a)
	copy(out[64:192], b)
	copy(out[192:256], c)
	return out
}
