// Package solana — Wave 4.2 / BC-11-C reputation program client.
//
// Program ID defaults to EnVE6eh… (devnet keypair). Mutations require
// on-chain deploy_allowed; verify_usage is gated when Groth16 settlement
// is enabled until ZKOnchainGroth16Ready().
package solana

import (
	"context"
	"encoding/binary"
	"fmt"
	"os"
	"strings"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"

	"github.com/proxyhubb/control-api/internal/decentralization"
)

const (
	// DefaultReputationProgramID is the Wave 4.2 devnet program ID (replaces Repu1111…).
	DefaultReputationProgramID = "EnVE6ehKA2dYi69B3Lo8wt2wyDgzLw4tdtSEKoMYe5bF"
)

var (
	discVerifyUsage            = anchorDiscriminator("verify_usage")
	discSetDeployAllowed       = anchorDiscriminator("set_deploy_allowed")
	discInitializeConfig       = anchorDiscriminator("initialize_config")
	discInitializeProviderFor  = anchorDiscriminator("initialize_provider_for")
)

// ReputationProgramID returns REPUTATION_PROGRAM_ID or the Wave 4.2 default.
// Empty / whitespace falls back to default. Refuses to silently use proxyhub ID
// when REPUTATION_PROGRAM_ID equals SOLANA_PROGRAM_ID (misconfig in old compose).
func ReputationProgramID() string {
	id := strings.TrimSpace(os.Getenv("REPUTATION_PROGRAM_ID"))
	if id == "" {
		return DefaultReputationProgramID
	}
	if id == effectiveProgramID() || id == DefaultProgramID {
		// Historical compose bug pointed reputation at proxyhub — fail closed to default.
		return DefaultReputationProgramID
	}
	return id
}

// ReputationProgramPubkey parses ReputationProgramID.
func ReputationProgramPubkey() (sol.PublicKey, error) {
	return sol.PublicKeyFromBase58(ReputationProgramID())
}

// ReputationStatusMeta is honesty payload for public APIs.
func ReputationStatusMeta() map[string]interface{} {
	id := ReputationProgramID()
	placeholder := strings.HasPrefix(id, "Repu1111")
	return map[string]interface{}{
		"program_id":            id,
		"placeholder":           placeholder,
		"deploy_path":           "scripts/deploy-reputation-devnet.ps1",
		"score_mode":            reputationScoreMode(),
		"zk_batch_gate":         decentralization.ZKOnchainGroth16Enabled(),
		"zk_onchain_groth16_ready": decentralization.ZKOnchainGroth16Ready(),
		"note": "Devnet: initialize_config + set_deploy_allowed(true) completed 2026-08-11. " +
			"After Groth16 settle, control-api credits scores via VerifyUsage with ZKBatchPDA " +
			"(program must be built with Cargo feature onchain-groth16).",
		"consume_path": "ZKAggregator → EnsureProviderReputation → VerifyUsage(ZKBatchPDA)",
	}
}

func reputationScoreMode() string {
	if decentralization.ZKOnchainGroth16Enabled() && !decentralization.ZKOnchainGroth16Ready() {
		return "fail_closed_awaiting_groth16"
	}
	if decentralization.ZKOnchainGroth16Ready() {
		return "require_zk_batch_pda"
	}
	return "oracle_attested_with_proof_hash"
}

// VerifyUsageParams for reputation verify_usage.
type VerifyUsageParams struct {
	ProviderWallet sol.PublicKey
	BatchRoot      [32]byte
	ProofHash      [32]byte
	TotalBytes     uint64
	// ZKBatchPDA optional; required when Groth16 ready / onchain-groth16 builds.
	ZKBatchPDA sol.PublicKey
}

// EncodeVerifyUsageData builds Anchor ix data:
// disc(8) + batch_root(32) + proof_hash(32) + total_bytes(8) = 80 bytes.
func EncodeVerifyUsageData(batchRoot, proofHash [32]byte, totalBytes uint64) []byte {
	data := make([]byte, 8+32+32+8)
	copy(data[0:8], discVerifyUsage[:])
	copy(data[8:40], batchRoot[:])
	copy(data[40:72], proofHash[:])
	binary.LittleEndian.PutUint64(data[72:80], totalBytes)
	return data
}

// GateReputationScoreUpdate fail-closes score credits when Groth16 settlement
// is required but not ready (Wave 4.2 exit claim).
func GateReputationScoreUpdate() error {
	return decentralization.GateOnchainGroth16Settlement()
}

// VerifyUsage submits oracle-signed verify_usage for a provider.
func (c *OracleClient) VerifyUsage(ctx context.Context, params VerifyUsageParams) (string, error) {
	if err := GateReputationScoreUpdate(); err != nil {
		return "", err
	}
	if params.BatchRoot == ([32]byte{}) || params.ProofHash == ([32]byte{}) {
		return "", fmt.Errorf("VerifyUsage: batch_root and proof_hash must be non-zero")
	}
	if params.TotalBytes == 0 {
		return "", fmt.Errorf("VerifyUsage: total_bytes must be > 0")
	}

	repProgram, err := ReputationProgramPubkey()
	if err != nil {
		return "", fmt.Errorf("VerifyUsage: reputation program id: %w", err)
	}

	oraclePK := c.GetOraclePublicKey()
	repPDA, _, err := sol.FindProgramAddress(
		[][]byte{[]byte("reputation"), params.ProviderWallet.Bytes()},
		repProgram,
	)
	if err != nil {
		return "", fmt.Errorf("VerifyUsage: reputation PDA: %w", err)
	}
	configPDA, _, err := sol.FindProgramAddress([][]byte{[]byte("oracle_config")}, repProgram)
	if err != nil {
		return "", fmt.Errorf("VerifyUsage: oracle_config PDA: %w", err)
	}

	data := EncodeVerifyUsageData(params.BatchRoot, params.ProofHash, params.TotalBytes)
	accounts := []*sol.AccountMeta{
		{PublicKey: repPDA, IsSigner: false, IsWritable: true},
		{PublicKey: oraclePK, IsSigner: true, IsWritable: false},
		{PublicKey: configPDA, IsSigner: false, IsWritable: false},
	}
	if !params.ZKBatchPDA.IsZero() {
		accounts = append(accounts, &sol.AccountMeta{
			PublicKey: params.ZKBatchPDA, IsSigner: false, IsWritable: false,
		})
	} else if decentralization.ZKOnchainGroth16Ready() {
		return "", fmt.Errorf("VerifyUsage: ZKBatchPDA required when Groth16 ready")
	}

	instr := &GenericInstruction{
		programID: repProgram,
		accounts:  accounts,
		data:      data,
	}

	var recentBlockhash *rpc.GetLatestBlockhashResult
	if err = c.withFailover(ctx, func(client *rpc.Client) error {
		var e error
		recentBlockhash, e = client.GetLatestBlockhash(ctx, rpc.CommitmentFinalized)
		return e
	}); err != nil {
		return "", fmt.Errorf("VerifyUsage: blockhash: %w", err)
	}

	tx, err := sol.NewTransaction(
		[]sol.Instruction{instr},
		recentBlockhash.Value.Blockhash,
		sol.TransactionPayer(oraclePK),
	)
	if err != nil {
		return "", fmt.Errorf("VerifyUsage: build tx: %w", err)
	}
	if err = c.SignTransaction(ctx, tx); err != nil {
		return "", fmt.Errorf("VerifyUsage: sign: %w", err)
	}

	var txSig sol.Signature
	if err = c.withFailover(ctx, func(client *rpc.Client) error {
		var e error
		txSig, e = client.SendTransactionWithOpts(ctx, tx, rpc.TransactionOpts{
			SkipPreflight:       false,
			PreflightCommitment: rpc.CommitmentFinalized,
		})
		return e
	}); err != nil {
		return "", fmt.Errorf("VerifyUsage: send: %w", err)
	}
	return txSig.String(), nil
}

// GetProviderReputationPDA derives [b"reputation", provider].
func GetProviderReputationPDA(provider sol.PublicKey) (sol.PublicKey, uint8, error) {
	repProgram, err := ReputationProgramPubkey()
	if err != nil {
		return sol.PublicKey{}, 0, err
	}
	return sol.FindProgramAddress([][]byte{[]byte("reputation"), provider.Bytes()}, repProgram)
}

// EncodeInitializeProviderForData is disc-only (no args).
func EncodeInitializeProviderForData() []byte {
	data := make([]byte, 8)
	copy(data[0:8], discInitializeProviderFor[:])
	return data
}

// InitializeProviderFor creates the reputation PDA for provider, paid/signed by oracle.
func (c *OracleClient) InitializeProviderFor(ctx context.Context, provider sol.PublicKey) (string, error) {
	if provider.IsZero() {
		return "", fmt.Errorf("InitializeProviderFor: zero provider")
	}
	repProgram, err := ReputationProgramPubkey()
	if err != nil {
		return "", err
	}
	oraclePK := c.GetOraclePublicKey()
	if oraclePK.IsZero() {
		return "", fmt.Errorf("InitializeProviderFor: oracle signer missing")
	}
	repPDA, _, err := GetProviderReputationPDA(provider)
	if err != nil {
		return "", fmt.Errorf("InitializeProviderFor: reputation PDA: %w", err)
	}
	configPDA, _, err := GetReputationOracleConfigPDA()
	if err != nil {
		return "", fmt.Errorf("InitializeProviderFor: config PDA: %w", err)
	}
	ix := &GenericInstruction{
		programID: repProgram,
		accounts: []*sol.AccountMeta{
			{PublicKey: repPDA, IsSigner: false, IsWritable: true},
			{PublicKey: provider, IsSigner: false, IsWritable: false},
			{PublicKey: oraclePK, IsSigner: true, IsWritable: true},
			{PublicKey: configPDA, IsSigner: false, IsWritable: false},
			{PublicKey: sol.SystemProgramID, IsSigner: false, IsWritable: false},
		},
		data: EncodeInitializeProviderForData(),
	}
	return c.sendInstructionAsPayer(ctx, ix, oraclePK)
}

// EnsureProviderReputation initializes the provider PDA if missing.
func (c *OracleClient) EnsureProviderReputation(ctx context.Context, provider sol.PublicKey) error {
	repPDA, _, err := GetProviderReputationPDA(provider)
	if err != nil {
		return err
	}
	exists, err := c.accountInitialized(ctx, repPDA)
	if err != nil {
		return err
	}
	if exists {
		return nil
	}
	sig, err := c.InitializeProviderFor(ctx, provider)
	if err != nil {
		return err
	}
	deadline := time.Now().Add(60 * time.Second)
	for time.Now().Before(deadline) {
		ok, e := c.accountInitialized(ctx, repPDA)
		if e == nil && ok {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(750 * time.Millisecond):
		}
	}
	return fmt.Errorf("EnsureProviderReputation: PDA not visible after init sig=%s", sig)
}

func (c *OracleClient) accountInitialized(ctx context.Context, pda sol.PublicKey) (bool, error) {
	var info *rpc.GetAccountInfoResult
	err := c.withFailover(ctx, func(client *rpc.Client) error {
		var e error
		info, e = client.GetAccountInfoWithOpts(ctx, pda, &rpc.GetAccountInfoOpts{
			Commitment: rpc.CommitmentConfirmed,
		})
		return e
	})
	if err != nil {
		msg := strings.ToLower(err.Error())
		if strings.Contains(msg, "not found") || strings.Contains(msg, "could not find") {
			return false, nil
		}
		return false, fmt.Errorf("get account: %w", err)
	}
	if info == nil || info.Value == nil {
		return false, nil
	}
	return len(info.Value.Data.GetBinary()) > 0, nil
}

// waitForProxyhubAccount waits until pda exists and is owned by the proxyhub program.
func (c *OracleClient) waitForProxyhubAccount(ctx context.Context, pda sol.PublicKey) error {
	deadline := time.Now().Add(90 * time.Second)
	for time.Now().Before(deadline) {
		var info *rpc.GetAccountInfoResult
		err := c.withFailover(ctx, func(client *rpc.Client) error {
			var e error
			// Finalized: SimulateTransaction/send banks can lag Confirmed and treat
			// the PDA as system-owned → on-chain InvalidZkBatchOwner (6007).
			info, e = client.GetAccountInfoWithOpts(ctx, pda, &rpc.GetAccountInfoOpts{
				Commitment: rpc.CommitmentFinalized,
			})
			return e
		})
		if err == nil && info != nil && info.Value != nil &&
			info.Value.Owner == c.programID && len(info.Value.Data.GetBinary()) > 0 {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(750 * time.Millisecond):
		}
	}
	return fmt.Errorf("waitForProxyhubAccount: timeout pda=%s program=%s", pda, c.programID)
}

// ProviderBatchCredit is one provider's share of a settled usage batch.
type ProviderBatchCredit struct {
	Wallet     string
	TotalBytes uint64
}

// AggregateProviderBatchCredits sums usage bytes by provider wallet.
func AggregateProviderBatchCredits(entries []ProviderBatchCredit) []ProviderBatchCredit {
	sums := make(map[string]uint64)
	order := make([]string, 0)
	for _, p := range entries {
		w := strings.TrimSpace(p.Wallet)
		if w == "" || p.TotalBytes == 0 {
			continue
		}
		if _, ok := sums[w]; !ok {
			order = append(order, w)
		}
		sums[w] += p.TotalBytes
	}
	out := make([]ProviderBatchCredit, 0, len(order))
	for _, w := range order {
		out = append(out, ProviderBatchCredit{Wallet: w, TotalBytes: sums[w]})
	}
	return out
}

// CreditProvidersFromZKBatch ensures PDAs and submits verify_usage for each credit.
// When Groth16 is ready, ZKBatchPDA is required and passed as remaining account.
// Failures are returned aggregated; callers may log-and-continue.
func (c *OracleClient) CreditProvidersFromZKBatch(
	ctx context.Context,
	batchRoot [32]byte,
	proofHash [32]byte,
	credits []ProviderBatchCredit,
) (sigs []string, err error) {
	return c.CreditProvidersFromZKBatchWithPDA(ctx, batchRoot, proofHash, sol.PublicKey{}, credits)
}

// CreditProvidersFromZKBatchWithPDA is CreditProvidersFromZKBatch with an optional
// pre-derived ZKBatchPDA (avoids races / derivation mismatches after settle).
func (c *OracleClient) CreditProvidersFromZKBatchWithPDA(
	ctx context.Context,
	batchRoot [32]byte,
	proofHash [32]byte,
	zkBatchPDA sol.PublicKey,
	credits []ProviderBatchCredit,
) (sigs []string, err error) {
	if err := GateReputationScoreUpdate(); err != nil {
		return nil, err
	}
	var zkPDA sol.PublicKey
	if decentralization.ZKOnchainGroth16Ready() {
		zkPDA = zkBatchPDA
		if zkPDA.IsZero() {
			pda, _, e := c.GetZKBatchPDA(batchRoot)
			if e != nil {
				return nil, fmt.Errorf("CreditProvidersFromZKBatch: ZKBatchPDA: %w", e)
			}
			zkPDA = pda
		}
		if e := c.waitForProxyhubAccount(ctx, zkPDA); e != nil {
			return nil, fmt.Errorf("CreditProvidersFromZKBatch: wait ZKBatchPDA %s: %w", zkPDA, e)
		}
	}

	var firstErr error
	for _, credit := range credits {
		if credit.TotalBytes == 0 {
			continue
		}
		pk, e := sol.PublicKeyFromBase58(strings.TrimSpace(credit.Wallet))
		if e != nil {
			if firstErr == nil {
				firstErr = fmt.Errorf("provider wallet %q: %w", credit.Wallet, e)
			}
			continue
		}
		if e := c.EnsureProviderReputation(ctx, pk); e != nil {
			if firstErr == nil {
				firstErr = fmt.Errorf("ensure reputation %s: %w", credit.Wallet, e)
			}
			continue
		}
		sig, e := c.VerifyUsage(ctx, VerifyUsageParams{
			ProviderWallet: pk,
			BatchRoot:      batchRoot,
			ProofHash:      proofHash,
			TotalBytes:     credit.TotalBytes,
			ZKBatchPDA:     zkPDA,
		})
		if e != nil {
			if firstErr == nil {
				firstErr = fmt.Errorf("verify_usage %s: %w", credit.Wallet, e)
			}
			continue
		}
		sigs = append(sigs, sig)
	}
	return sigs, firstErr
}

// EncodeSetDeployAllowedData builds set_deploy_allowed(bool) ix data.
func EncodeSetDeployAllowedData(allowed bool) []byte {
	data := make([]byte, 9)
	copy(data[0:8], discSetDeployAllowed[:])
	if allowed {
		data[8] = 1
	}
	return data
}

// EncodeInitializeConfigData builds initialize_config(oracle_authority) ix data.
func EncodeInitializeConfigData(oracleAuthority sol.PublicKey) []byte {
	data := make([]byte, 8+32)
	copy(data[0:8], discInitializeConfig[:])
	copy(data[8:40], oracleAuthority.Bytes())
	return data
}

// GetReputationOracleConfigPDA derives [b"oracle_config"] for the reputation program.
func GetReputationOracleConfigPDA() (sol.PublicKey, uint8, error) {
	repProgram, err := ReputationProgramPubkey()
	if err != nil {
		return sol.PublicKey{}, 0, err
	}
	return sol.FindProgramAddress([][]byte{[]byte("oracle_config")}, repProgram)
}

// InitializeReputationConfig creates the oracle_config PDA (admin = oracle signer).
func (c *OracleClient) InitializeReputationConfig(ctx context.Context, oracleAuthority sol.PublicKey) (string, error) {
	repProgram, err := ReputationProgramPubkey()
	if err != nil {
		return "", err
	}
	admin := c.GetOraclePublicKey()
	if admin.IsZero() {
		return "", fmt.Errorf("InitializeReputationConfig: oracle signer missing")
	}
	if oracleAuthority.IsZero() {
		oracleAuthority = admin
	}
	configPDA, _, err := GetReputationOracleConfigPDA()
	if err != nil {
		return "", fmt.Errorf("InitializeReputationConfig: config PDA: %w", err)
	}
	ix := &GenericInstruction{
		programID: repProgram,
		accounts: []*sol.AccountMeta{
			{PublicKey: configPDA, IsSigner: false, IsWritable: true},
			{PublicKey: admin, IsSigner: true, IsWritable: true},
			{PublicKey: sol.SystemProgramID, IsSigner: false, IsWritable: false},
		},
		data: EncodeInitializeConfigData(oracleAuthority),
	}
	return c.sendInstructionAsPayer(ctx, ix, admin)
}

// SetReputationDeployAllowed flips deploy_allowed on oracle_config (admin signer).
func (c *OracleClient) SetReputationDeployAllowed(ctx context.Context, allowed bool) (string, error) {
	repProgram, err := ReputationProgramPubkey()
	if err != nil {
		return "", err
	}
	admin := c.GetOraclePublicKey()
	if admin.IsZero() {
		return "", fmt.Errorf("SetReputationDeployAllowed: oracle signer missing")
	}
	configPDA, _, err := GetReputationOracleConfigPDA()
	if err != nil {
		return "", fmt.Errorf("SetReputationDeployAllowed: config PDA: %w", err)
	}
	ix := &GenericInstruction{
		programID: repProgram,
		accounts: []*sol.AccountMeta{
			{PublicKey: configPDA, IsSigner: false, IsWritable: true},
			{PublicKey: admin, IsSigner: true, IsWritable: false},
		},
		data: EncodeSetDeployAllowedData(allowed),
	}
	return c.sendInstructionAsPayer(ctx, ix, admin)
}

// Legacy badge-anchor constants (Phase 21 FE hook). Not the Wave 4.2 verify_usage path.
const (
	RepTypeBadge = "badge"
)

// AnchorReputation is a no-op stub for historical badge awards.
// Wave 4.2 score credits use VerifyUsage against REPUTATION_PROGRAM_ID instead.
func (c *OracleClient) AnchorReputation(ctx context.Context, wallet string, repType string, hashHex string) error {
	_ = ctx
	_ = wallet
	_ = repType
	_ = hashHex
	return fmt.Errorf("AnchorReputation deprecated: use VerifyUsage on %s", ReputationProgramID())
}
