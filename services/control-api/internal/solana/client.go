// Package solana provides Solana blockchain integration for the ProxyHub oracle.
// It handles escrow settlement, refunds, and on-chain event monitoring.
package solana

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"strings"
	"sync"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"
	"github.com/proxyhubb/control-api/internal/decentralization"
)

const (
	// DefaultProgramID is the ProxyHub Anchor program on devnet — overridden by SOLANA_PROGRAM_ID env var.
	DefaultProgramID = "AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu"

	// ProgramID kept for backward-compat references in this package; prefer effectiveProgramID().
	ProgramID = DefaultProgramID

	// EscrowDiscriminator is the first 8 bytes of sha256("account:Escrow")
	EscrowDiscriminator = "b8e2f40c"
)

// effectiveProgramID returns the Solana program ID from SOLANA_PROGRAM_ID env var,
// falling back to the compiled-in DefaultProgramID.
func effectiveProgramID() string {
	if id := os.Getenv("SOLANA_PROGRAM_ID"); id != "" {
		return id
	}
	return DefaultProgramID
}

// EscrowStatus represents the on-chain escrow state
type EscrowStatus int

const (
	EscrowPending EscrowStatus = iota
	EscrowActive
	EscrowSettled
	EscrowRefunded
	EscrowDisputed
)

func (s EscrowStatus) String() string {
	switch s {
	case EscrowPending:
		return "Pending"
	case EscrowActive:
		return "Active"
	case EscrowSettled:
		return "Settled"
	case EscrowRefunded:
		return "Refunded"
	case EscrowDisputed:
		return "Disputed"
	default:
		return "Unknown"
	}
}

// Escrow represents the on-chain escrow account data
type Escrow struct {
	Buyer            sol.PublicKey `json:"buyer"`
	Seller           sol.PublicKey `json:"seller"`
	Amount           uint64        `json:"amount"`
	BandwidthLimitGB uint64        `json:"bandwidth_limit_gb"`
	BandwidthUsedGB  uint64        `json:"bandwidth_used_gb"`
	Status           EscrowStatus  `json:"status"`
	CreatedAt        int64         `json:"created_at"`
	ExpiresAt        int64         `json:"expires_at"`
	Bump             uint8         `json:"bump"`
}

// OracleClient provides methods to interact with the ProxyHub Solana program
type OracleClient struct {
	rpcClients []*rpc.Client
	currentIdx int
	programID  sol.PublicKey
	oracleKey  sol.PrivateKey
	// treasuryHotKey is the operational payout wallet (BC-08). When set and
	// distinct from oracleKey, SendSOL / BatchTransferSOL spend from this key
	// instead of the oracle signing key. Empty means legacy "oracle == treasury".
	treasuryHotKey sol.PrivateKey
	hsm            HSMSigner
	network        string
	velocity       *VelocityGuard // nil until SetVelocityGuard is called

	balMu    sync.Mutex
	balCache map[string]balCacheEntry
}

type balCacheEntry struct {
	lamports uint64
	at       time.Time
}

const balanceCacheTTL = 12 * time.Second

// SetVelocityGuard attaches a VelocityGuard to the client.
// Call this in main.go after creating the OracleClient and initialising Redis.
// Until this is called, velocity limits are not enforced (logs a warning per transfer).
func (c *OracleClient) SetVelocityGuard(vg *VelocityGuard) {
	c.velocity = vg
}

// VelocityGuardInstance returns the attached guard, or nil.
func (c *OracleClient) VelocityGuardInstance() *VelocityGuard {
	return c.velocity
}

// Config holds the Solana client configuration
type Config struct {
	// RPC endpoints (comma-separated or slice)
	RPCEndpoints []string
	// Path to oracle keypair JSON file (signing authority — settle/attest)
	OracleKeypairPath string
	// Path to treasury hot keypair JSON file (payout wallet — SendSOL).
	// When empty, payouts fall back to the oracle key (legacy, discouraged).
	TreasuryHotKeypairPath string
	// Network name for logging (devnet, mainnet-beta)
	Network string
}

// NewOracleClient creates a new Solana oracle client
func NewOracleClient(cfg Config) (*OracleClient, error) {
	// Parse program ID (from env var SOLANA_PROGRAM_ID, falling back to compiled-in default)
	programID, err := sol.PublicKeyFromBase58(effectiveProgramID())
	if err != nil {
		return nil, fmt.Errorf("invalid program ID: %w", err)
	}

	var hsm HSMSigner
	var oracleKey sol.PrivateKey

	useGCP := os.Getenv("USE_GCP_KMS") == "true"
	useAWS := os.Getenv("USE_AWS_KMS") == "true"
	// Prefer GCP Cloud KMS when both flags are set (GCP deployment path).
	if useGCP {
		keyName := strings.TrimSpace(os.Getenv("GCP_KMS_KEY_NAME"))
		pubKeyStr := strings.TrimSpace(os.Getenv("GCP_KMS_PUBLIC_KEY"))
		signer, err := NewGCPKMSSigner(context.Background(), keyName, pubKeyStr)
		if err != nil {
			if gcpKMSStrictEnv() {
				return nil, fmt.Errorf("USE_GCP_KMS=true but Cloud KMS init failed: %w", err)
			}
			fmt.Printf("[SolanaClient] GCP KMS initialization failed (%v). Falling back to mock HSM signer.\n", err)
			k, keyErr := loadKeypair(cfg.OracleKeypairPath)
			if keyErr != nil {
				fmt.Printf("[SolanaClient] Keypair file missing. Generating random key for mock HSM.\n")
				k, _ = GenerateRandomKeypair()
			}
			hsm = NewMockHSMSigner(k)
		} else {
			hsm = signer
			fmt.Printf("[SolanaClient] Initialized GCP Cloud KMS signer: %s (pubkey %s)\n", keyName, signer.PublicKey())
		}
	} else if useAWS {
		kmsKeyID := os.Getenv("AWS_KMS_KEY_ID")
		kmsPubKeyStr := os.Getenv("AWS_KMS_PUBLIC_KEY")

		var pubKey sol.PublicKey
		if kmsPubKeyStr != "" {
			var err error
			pubKey, err = sol.PublicKeyFromBase58(kmsPubKeyStr)
			if err != nil {
				return nil, fmt.Errorf("invalid AWS_KMS_PUBLIC_KEY: %w", err)
			}
		} else {
			// Fallback: load public key from keypair path if possible
			k, err := loadKeypair(cfg.OracleKeypairPath)
			if err == nil {
				pubKey = k.PublicKey()
			}
		}

		// Attempt to create AWS KMSSigner
		signer, err := NewAWSKMSSigner(kmsKeyID, pubKey)
		if err != nil {
			env := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
			strict := env == "production" || env == "prod" || env == "staging" ||
				strings.EqualFold(strings.TrimSpace(os.Getenv("PROXYHUB_REQUIRE_AWS_KMS")), "true")
			if strict {
				return nil, fmt.Errorf("USE_AWS_KMS=true but KMS init failed in %s: %w", env, err)
			}
			// Fallback to MockHSMSigner using keypair if AWS credentials are not set (e.g. dev/testing)
			fmt.Printf("[SolanaClient] KMS initialization failed (%v). Falling back to mock HSM signer.\n", err)
			k, keyErr := loadKeypair(cfg.OracleKeypairPath)
			if keyErr != nil {
				// Create a random mock key to prevent startup failure
				fmt.Printf("[SolanaClient] Keypair file missing. Generating random key for mock HSM.\n")
				k, _ = GenerateRandomKeypair()
			}
			hsm = NewMockHSMSigner(k)
		} else {
			hsm = signer
			fmt.Printf("[SolanaClient] Initialized AWS KMS HSM signer with key: %s\n", kmsKeyID)
		}
	} else {
		// Standard local keypair flow
		k, err := loadKeypair(cfg.OracleKeypairPath)
		if err != nil {
			return nil, fmt.Errorf("failed to load oracle keypair: %w", err)
		}
		oracleKey = k
		hsm = NewMockHSMSigner(k)
	}

	var treasuryHot sol.PrivateKey
	if path := strings.TrimSpace(cfg.TreasuryHotKeypairPath); path != "" {
		tk, err := loadKeypair(path)
		if err != nil {
			return nil, fmt.Errorf("failed to load treasury hot keypair: %w", err)
		}
		treasuryHot = tk
	}

	cfg.RPCEndpoints = NormalizeRPCEndpoints(cfg.RPCEndpoints)
	if len(cfg.RPCEndpoints) == 0 {
		return nil, fmt.Errorf("no RPC endpoints provided")
	}

	// Create RPC clients
	rpcClients := make([]*rpc.Client, len(cfg.RPCEndpoints))
	for i, endpoint := range cfg.RPCEndpoints {
		rpcClients[i] = NewRPCClient(endpoint)
	}

	client := &OracleClient{
		rpcClients:     rpcClients,
		currentIdx:     0,
		programID:      programID,
		oracleKey:      oracleKey,
		treasuryHotKey: treasuryHot,
		hsm:            hsm,
		network:        cfg.Network,
		balCache:       make(map[string]balCacheEntry),
	}

	if err := client.validateCustodySeparation(); err != nil {
		return nil, err
	}

	return client, nil
}

// rpc returns the current active RPC client
func (c *OracleClient) rpc() *rpc.Client {
	if len(c.rpcClients) == 0 {
		return nil
	}
	return c.rpcClients[c.currentIdx]
}

// rotateRPC switches to the next available RPC endpoint
func (c *OracleClient) rotateRPC() {
	c.currentIdx = (c.currentIdx + 1) % len(c.rpcClients)
}

// GetRecentBlockhash returns the base58-encoded latest blockhash from Solana.
// Used by the auth challenge endpoint (D-A1) to embed a network-verifiable
// entropy source in login nonces.
func (c *OracleClient) GetRecentBlockhash(ctx context.Context) (string, error) {
	result, err := c.rpc().GetLatestBlockhash(ctx, rpc.CommitmentFinalized)
	if err != nil {
		return "", fmt.Errorf("GetRecentBlockhash: %w", err)
	}
	return result.Value.Blockhash.String(), nil
}

// loadKeypair loads a Solana keypair from a file.
// P0-14: if ORACLE_KEYPAIR_ENCRYPTION_KEY is set the file is expected to be
// AES-256-GCM encrypted (written by EncryptKeypairFile); otherwise the legacy
// plaintext JSON format is accepted so existing dev setups keep working.
func loadKeypair(path string) (sol.PrivateKey, error) {
	if encKey := os.Getenv("ORACLE_KEYPAIR_ENCRYPTION_KEY"); encKey != "" {
		return LoadEncryptedKeypairFromFile(path, encKey)
	}
	return LoadKeypairFromFile(path)
}

// LoadKeypairFromFile loads a Solana keypair from a plaintext JSON file.
// The file must contain a JSON array of 64 bytes (Solana keypair format).
func LoadKeypairFromFile(path string) (sol.PrivateKey, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read keypair file: %w", err)
	}
	defer zeroBytes(data)

	var keypairBytes []byte
	if err := json.Unmarshal(data, &keypairBytes); err != nil {
		return nil, fmt.Errorf("failed to parse keypair JSON: %w", err)
	}
	defer zeroBytes(keypairBytes)

	if len(keypairBytes) != 64 {
		return nil, fmt.Errorf("invalid keypair length: expected 64, got %d", len(keypairBytes))
	}

	out := make(sol.PrivateKey, 64)
	copy(out, keypairBytes)
	return out, nil
}

// LoadEncryptedKeypairFromFile decrypts an AES-256-GCM-encrypted keypair file.
//
// File format (all hex-encoded, newline-separated):
//
//	line 1: 32-byte nonce (hex)
//	line 2: ciphertext (hex)
//
// encryptionKey must be a 64-hex-char string (32 raw bytes).
// Use EncryptKeypairFile to produce a compatible file from a plaintext keypair.
func LoadEncryptedKeypairFromFile(path, encryptionKeyHex string) (sol.PrivateKey, error) {
	keyBytes, err := hex.DecodeString(encryptionKeyHex)
	if err != nil || len(keyBytes) != 32 {
		return nil, fmt.Errorf("ORACLE_KEYPAIR_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)")
	}
	defer zeroBytes(keyBytes)

	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read encrypted keypair file: %w", err)
	}

	// Split into nonce line and ciphertext line
	lines := splitLines(raw)
	if len(lines) < 2 {
		return nil, fmt.Errorf("encrypted keypair file: expected 2 lines (nonce + ciphertext), got %d", len(lines))
	}

	nonce, err := hex.DecodeString(lines[0])
	if err != nil {
		return nil, fmt.Errorf("encrypted keypair file: invalid nonce hex: %w", err)
	}
	ciphertext, err := hex.DecodeString(lines[1])
	if err != nil {
		return nil, fmt.Errorf("encrypted keypair file: invalid ciphertext hex: %w", err)
	}

	block, err := aes.NewCipher(keyBytes)
	if err != nil {
		return nil, fmt.Errorf("AES cipher init failed: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("AES-GCM init failed: %w", err)
	}
	if len(nonce) != gcm.NonceSize() {
		return nil, fmt.Errorf("encrypted keypair file: nonce length %d != expected %d", len(nonce), gcm.NonceSize())
	}

	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, fmt.Errorf("AES-GCM decryption failed (wrong key?): %w", err)
	}
	defer zeroBytes(plaintext)

	var keypairBytes []byte
	if err := json.Unmarshal(plaintext, &keypairBytes); err != nil {
		return nil, fmt.Errorf("failed to parse decrypted keypair JSON: %w", err)
	}
	defer zeroBytes(keypairBytes)

	if len(keypairBytes) != 64 {
		return nil, fmt.Errorf("invalid keypair length: expected 64, got %d", len(keypairBytes))
	}

	out := make(sol.PrivateKey, 64)
	copy(out, keypairBytes)
	return out, nil
}

// zeroBytes overwrites a byte slice with zeros to clear key material from memory.
func zeroBytes(b []byte) {
	for i := range b {
		b[i] = 0
	}
}

// splitLines splits a byte slice on newlines, trimming whitespace.
func splitLines(b []byte) []string {
	var lines []string
	start := 0
	for i, c := range b {
		if c == '\n' {
			line := string(b[start:i])
			if trimmed := trimSpace(line); trimmed != "" {
				lines = append(lines, trimmed)
			}
			start = i + 1
		}
	}
	if rest := trimSpace(string(b[start:])); rest != "" {
		lines = append(lines, rest)
	}
	return lines
}

func trimSpace(s string) string {
	start, end := 0, len(s)
	for start < end && (s[start] == ' ' || s[start] == '\t' || s[start] == '\r') {
		start++
	}
	for end > start && (s[end-1] == ' ' || s[end-1] == '\t' || s[end-1] == '\r') {
		end--
	}
	return s[start:end]
}

// GetOraclePublicKey returns the oracle's public key
func (c *OracleClient) GetOraclePublicKey() sol.PublicKey {
	if c.hsm != nil {
		return c.hsm.PublicKey()
	}
	return c.oracleKey.PublicKey()
}

// GetPayoutPublicKey returns the wallet that funds SendSOL / BatchTransferSOL.
// Prefer the dedicated treasury hot key (BC-08); fall back to oracle for legacy deploys.
func (c *OracleClient) GetPayoutPublicKey() sol.PublicKey {
	if len(c.treasuryHotKey) > 0 {
		return c.treasuryHotKey.PublicKey()
	}
	return c.GetOraclePublicKey()
}

// HasSeparateTreasuryHot reports whether a distinct treasury hot keypair is loaded.
func (c *OracleClient) HasSeparateTreasuryHot() bool {
	if len(c.treasuryHotKey) == 0 {
		return false
	}
	return !c.treasuryHotKey.PublicKey().Equals(c.GetOraclePublicKey())
}

func isProdLikeEnv() bool {
	env := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
	switch env {
	case "production", "prod", "staging", "testnet":
		return true
	default:
		return false
	}
}

// validateCustodySeparation enforces BC-08 in prod-like envs: oracle signing key must
// not be the same wallet as the treasury hot payout key.
func (c *OracleClient) validateCustodySeparation() error {
	prod := isProdLikeEnv()

	if len(c.treasuryHotKey) == 0 {
		if prod {
			return fmt.Errorf("BC-08: SOLANA_TREASURY_HOT_KEYPAIR is required in %s (oracle must not fund payouts)", strings.TrimSpace(os.Getenv("APP_ENV")))
		}
		return nil
	}

	if c.treasuryHotKey.PublicKey().Equals(c.GetOraclePublicKey()) {
		if prod {
			return fmt.Errorf("BC-08: treasury hot keypair pubkey equals oracle pubkey — custody not split")
		}
		fmt.Printf("[SolanaClient] WARNING: treasury hot keypair matches oracle (legacy custody); set distinct keys before production\n")
	}
	return nil
}

// ValidateConfiguredTreasuryAddresses checks env pubkeys against loaded keys (BC-08).
// Call after env is fully loaded. Returns a non-nil error in production on misconfig.
func ValidateConfiguredTreasuryAddresses(oracle *OracleClient) error {
	if oracle == nil {
		return nil
	}
	env := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
	prod := isProdLikeEnv()

	oraclePK := oracle.GetOraclePublicKey()
	payoutPK := oracle.GetPayoutPublicKey()

	hotExplicit := strings.TrimSpace(os.Getenv("SOLANA_TREASURY_HOT_ADDRESS"))
	legacyTreasury := strings.TrimSpace(os.Getenv("SOLANA_TREASURY_ADDRESS"))
	hotEnv := hotExplicit
	if hotEnv == "" {
		hotEnv = legacyTreasury
	}
	// After vault cutover both must be set and must differ (deposit/legacy addr ≠ payout float).
	if prod && hotExplicit != "" && legacyTreasury != "" && hotExplicit == legacyTreasury {
		return fmt.Errorf("BC-08: SOLANA_TREASURY_ADDRESS must differ from SOLANA_TREASURY_HOT_ADDRESS after deposit vault cutover (set treasury to vault PDA)")
	}
	if hotEnv != "" {
		hotPK, err := sol.PublicKeyFromBase58(hotEnv)
		if err != nil {
			return fmt.Errorf("invalid SOLANA_TREASURY_HOT_ADDRESS/SOLANA_TREASURY_ADDRESS: %w", err)
		}
		if !hotPK.Equals(payoutPK) {
			msg := fmt.Sprintf("treasury hot address %s does not match payout keypair %s", hotPK, payoutPK)
			if prod {
				return fmt.Errorf("BC-08: %s", msg)
			}
			fmt.Printf("[SolanaClient] WARNING: %s\n", msg)
		}
		if hotPK.Equals(oraclePK) && prod {
			return fmt.Errorf("BC-08: SOLANA_TREASURY_HOT_ADDRESS equals oracle pubkey — deposit/payout custody not split")
		}
	}

	coldEnv := strings.TrimSpace(os.Getenv("SOLANA_TREASURY_COLD_ADDRESS"))
	if coldEnv != "" {
		coldPK, err := sol.PublicKeyFromBase58(coldEnv)
		if err != nil {
			return fmt.Errorf("invalid SOLANA_TREASURY_COLD_ADDRESS: %w", err)
		}
		if coldPK.Equals(oraclePK) || coldPK.Equals(payoutPK) {
			msg := "SOLANA_TREASURY_COLD_ADDRESS must differ from oracle and hot treasury"
			if prod {
				return fmt.Errorf("BC-08: %s", msg)
			}
			fmt.Printf("[SolanaClient] WARNING: %s\n", msg)
		}
	} else if prod {
		fmt.Printf("[SolanaClient] WARNING: SOLANA_TREASURY_COLD_ADDRESS unset — cold storage not configured\n")
	}

	vaultEnv := strings.TrimSpace(os.Getenv("SOLANA_DEPOSIT_VAULT_ADDRESS"))
	if vaultEnv != "" {
		vaultPK, err := sol.PublicKeyFromBase58(vaultEnv)
		if err != nil {
			return fmt.Errorf("invalid SOLANA_DEPOSIT_VAULT_ADDRESS: %w", err)
		}
		if vaultPK.Equals(oraclePK) || vaultPK.Equals(payoutPK) {
			msg := "SOLANA_DEPOSIT_VAULT_ADDRESS must differ from oracle and hot treasury"
			if prod {
				return fmt.Errorf("BC-08: %s", msg)
			}
			fmt.Printf("[SolanaClient] WARNING: %s\n", msg)
		}
		if coldEnv != "" {
			if coldPK, err := sol.PublicKeyFromBase58(coldEnv); err == nil && vaultPK.Equals(coldPK) {
				msg := "SOLANA_DEPOSIT_VAULT_ADDRESS must differ from cold treasury"
				if prod {
					return fmt.Errorf("BC-08: %s", msg)
				}
				fmt.Printf("[SolanaClient] WARNING: %s\n", msg)
			}
		}
		if derived, _, err := oracle.GetDepositVaultPDA(); err == nil && !derived.Equals(vaultPK) {
			msg := fmt.Sprintf("SOLANA_DEPOSIT_VAULT_ADDRESS %s does not match derived PDA %s", vaultPK, derived)
			if prod {
				return fmt.Errorf("BC-08: %s", msg)
			}
			fmt.Printf("[SolanaClient] WARNING: %s\n", msg)
		}
	}

	_ = env
	return nil
}

// SignMessage signs arbitrary message bytes using the oracle's HSM or private key.
func (c *OracleClient) SignMessage(ctx context.Context, message []byte) ([]byte, error) {
	if c.hsm != nil {
		return c.hsm.Sign(ctx, message)
	}
	return ed25519.Sign(ed25519.PrivateKey(c.oracleKey), message), nil
}

// SignTransaction signs a Solana transaction using the oracle's HSM or private key.
// SignTransaction signs a Solana transaction with any keys this client holds
// (oracle HSM/local key and optional treasury hot key).
func (c *OracleClient) SignTransaction(ctx context.Context, tx *sol.Transaction) error {
	msgBytes, err := tx.Message.MarshalBinary()
	if err != nil {
		return fmt.Errorf("failed to marshal transaction message: %w", err)
	}

	n := int(tx.Message.Header.NumRequiredSignatures)
	if len(tx.Signatures) < n {
		newSigs := make([]sol.Signature, n)
		copy(newSigs, tx.Signatures)
		tx.Signatures = newSigs
	}

	for i := 0; i < n; i++ {
		key := tx.Message.AccountKeys[i]
		var sigBytes []byte

		switch {
		case len(c.treasuryHotKey) > 0 && key.Equals(c.treasuryHotKey.PublicKey()):
			sigBytes = ed25519.Sign(ed25519.PrivateKey(c.treasuryHotKey), msgBytes)
		case c.hsm != nil && key.Equals(c.hsm.PublicKey()):
			sigBytes, err = c.hsm.Sign(ctx, msgBytes)
			if err != nil {
				return fmt.Errorf("failed to sign with HSM: %w", err)
			}
		case len(c.oracleKey) > 0 && key.Equals(c.oracleKey.PublicKey()):
			sigBytes = ed25519.Sign(ed25519.PrivateKey(c.oracleKey), msgBytes)
		default:
			return fmt.Errorf("missing signer material for required key %s", key.String())
		}

		var signature sol.Signature
		copy(signature[:], sigBytes)
		tx.Signatures[i] = signature
	}
	return nil
}

// GetNetwork returns the current network (devnet, mainnet-beta, etc)
func (c *OracleClient) GetNetwork() string {
	return c.network
}

// GetProgramID returns the program ID
func (c *OracleClient) GetProgramID() sol.PublicKey {
	return c.programID
}

// GetEscrowPDA derives the escrow PDA address for a buyer-seller pair
func (c *OracleClient) GetEscrowPDA(buyer, seller sol.PublicKey) (sol.PublicKey, uint8, error) {
	pda, bump, err := sol.FindProgramAddress(
		[][]byte{
			[]byte("escrow"),
			buyer.Bytes(),
			seller.Bytes(),
		},
		c.programID,
	)
	if err != nil {
		return sol.PublicKey{}, 0, fmt.Errorf("failed to derive PDA: %w", err)
	}
	return pda, bump, nil
}

// withFailover executes an RPC call with automatic failover.
// P2-03: Always rotate after each attempt so that after a full cycle the
// index returns to its starting position.  Without this, a complete failure
// leaves currentIdx pointing at the last-tried (broken) endpoint, meaning the
// next call skips the primary entirely.
func (c *OracleClient) withFailover(ctx context.Context, f func(client *rpc.Client) error) error {
	var lastErr error
	for i := 0; i < len(c.rpcClients); i++ {
		err := f(c.rpc())
		if err == nil {
			return nil
		}
		lastErr = err
		c.rotateRPC() // rotate unconditionally — full cycle restores starting index
	}
	return lastErr
}

// FetchEscrow fetches and decodes an escrow account from the chain
func (c *OracleClient) FetchEscrow(ctx context.Context, escrowPDA sol.PublicKey) (*Escrow, error) {
	var accountInfo *rpc.GetAccountInfoResult
	err := c.withFailover(ctx, func(client *rpc.Client) error {
		var err error
		accountInfo, err = client.GetAccountInfo(ctx, escrowPDA)
		return err
	})
	if err != nil {
		return nil, fmt.Errorf("failed to fetch escrow account: %w", err)
	}

	if accountInfo == nil || accountInfo.Value == nil {
		return nil, fmt.Errorf("escrow account not found")
	}

	data := accountInfo.Value.Data.GetBinary()
	if len(data) < 8 {
		return nil, fmt.Errorf("account data too short")
	}

	// Skip 8-byte discriminator
	data = data[8:]

	// P2-05: Escrow account field offsets (post-discriminator).
	// Layout must match programs/proxyhub Escrow:
	// buyer(32) seller(32) amount(u64) bw_limit(u64) bw_used(u64) status(u8)
	// created(i64) expires(i64) price_oracle(32) price_timestamp(i64) bump(u8)
	const (
		escrowOffBuyer            = 0
		escrowOffSeller           = 32
		escrowOffAmount           = 64
		escrowOffBandwidthLimitGB = 72
		escrowOffBandwidthUsedGB  = 80
		escrowOffStatus           = 88
		escrowOffCreatedAt        = 89
		escrowOffExpiresAt        = 97
		escrowOffPriceOracle      = 105 // price_oracle pubkey starts here
		escrowOffBump             = 145 // after price_oracle(32)+price_timestamp(8)
		escrowMinSize             = 146
	)
	_ = escrowOffPriceOracle

	if len(data) < escrowMinSize {
		return nil, fmt.Errorf("account data too short for escrow: got %d, need %d", len(data), escrowMinSize)
	}

	escrow := &Escrow{
		Buyer:            sol.PublicKeyFromBytes(data[escrowOffBuyer:escrowOffSeller]),
		Seller:           sol.PublicKeyFromBytes(data[escrowOffSeller:escrowOffAmount]),
		Amount:           bytesToUint64(data[escrowOffAmount:escrowOffBandwidthLimitGB]),
		BandwidthLimitGB: bytesToUint64(data[escrowOffBandwidthLimitGB:escrowOffBandwidthUsedGB]),
		BandwidthUsedGB:  bytesToUint64(data[escrowOffBandwidthUsedGB:escrowOffStatus]),
		Status:           EscrowStatus(data[escrowOffStatus]),
		CreatedAt:        int64(bytesToUint64(data[escrowOffCreatedAt:escrowOffExpiresAt])),
		ExpiresAt:        int64(bytesToUint64(data[escrowOffExpiresAt:escrowOffPriceOracle])),
		Bump:             data[escrowOffBump],
	}

	return escrow, nil
}

// bytesToUint64 converts a little-endian byte slice to uint64
func bytesToUint64(b []byte) uint64 {
	if len(b) < 8 {
		return 0
	}
	return uint64(b[0]) | uint64(b[1])<<8 | uint64(b[2])<<16 | uint64(b[3])<<24 |
		uint64(b[4])<<32 | uint64(b[5])<<40 | uint64(b[6])<<48 | uint64(b[7])<<56
}

// GetCurrentSlot returns the cluster's finalized slot.
func (c *OracleClient) GetCurrentSlot(ctx context.Context) (uint64, error) {
	var slot uint64
	err := c.withFailover(ctx, func(client *rpc.Client) error {
		s, callErr := client.GetSlot(ctx, rpc.CommitmentFinalized)
		if callErr != nil {
			return callErr
		}
		slot = s
		return nil
	})
	if err != nil {
		return 0, fmt.Errorf("GetCurrentSlot: %w", err)
	}
	return slot, nil
}

// GetBalance returns the SOL balance of the specified wallet.
// Retries with backoff + RPC failover on transient failures (e.g. public-devnet 429s).
// Successful reads are cached briefly so withdraw preflight survives RPC blips.
func (c *OracleClient) GetBalance(ctx context.Context, pubkey sol.PublicKey) (uint64, error) {
	key := pubkey.String()
	c.balMu.Lock()
	if ent, ok := c.balCache[key]; ok && time.Since(ent.at) < balanceCacheTTL {
		lamports := ent.lamports
		c.balMu.Unlock()
		return lamports, nil
	}
	c.balMu.Unlock()

	var balance *rpc.GetBalanceResult
	var lastErr error
	backoffs := []time.Duration{0, 400 * time.Millisecond, 1200 * time.Millisecond, 2500 * time.Millisecond}
	for attempt, wait := range backoffs {
		if wait > 0 {
			select {
			case <-ctx.Done():
				// Prefer a recent cached value over failing the whole withdraw.
				c.balMu.Lock()
				ent, ok := c.balCache[key]
				c.balMu.Unlock()
				if ok && time.Since(ent.at) < 60*time.Second {
					return ent.lamports, nil
				}
				return 0, ctx.Err()
			case <-time.After(wait):
			}
		}
		err := c.withFailover(ctx, func(client *rpc.Client) error {
			var callErr error
			balance, callErr = client.GetBalance(ctx, pubkey, rpc.CommitmentConfirmed)
			return callErr
		})
		if err == nil {
			c.balMu.Lock()
			c.balCache[key] = balCacheEntry{lamports: balance.Value, at: time.Now()}
			c.balMu.Unlock()
			return balance.Value, nil
		}
		lastErr = err
		if attempt+1 < len(backoffs) {
			c.rotateRPC()
		}
	}
	// Stale cache fallback (up to 60s) beats hard-failing withdrawals on flaky public RPCs.
	c.balMu.Lock()
	ent, ok := c.balCache[key]
	c.balMu.Unlock()
	if ok && time.Since(ent.at) < 60*time.Second {
		return ent.lamports, nil
	}
	return 0, fmt.Errorf("failed to get balance: %w", lastErr)
}

// GetTokenBalance returns the balance of an SPL token ATA
func (c *OracleClient) GetTokenBalance(ctx context.Context, wallet, mint sol.PublicKey) (uint64, error) {
	ata, _, err := sol.FindAssociatedTokenAddress(wallet, mint)
	if err != nil {
		return 0, err
	}

	var balance *rpc.GetTokenAccountBalanceResult
	err = c.withFailover(ctx, func(client *rpc.Client) error {
		var err error
		balance, err = client.GetTokenAccountBalance(ctx, ata, rpc.CommitmentFinalized)
		return err
	})
	if err != nil {
		return 0, err
	}

	if balance == nil || balance.Value == nil {
		return 0, nil
	}

	return bytesToUint64([]byte(balance.Value.Amount)), nil // Simplified since we just need the raw amount
}

// ============== ADMIN CONFIG ==============

// AdminConfig represents the on-chain admin configuration account
type AdminConfig struct {
	Admin        sol.PublicKey `json:"admin"`
	PendingAdmin sol.PublicKey `json:"pending_admin"`
	CreatedAt    int64         `json:"created_at"`
	UpdatedAt    int64         `json:"updated_at"`
	Bump         uint8         `json:"bump"`
}

// AdminConfig account size: 8 (discriminator) + 32 + 32 + 8 + 8 + 1 = 89 bytes
const AdminConfigLen = 89

// GetAdminConfigPDA derives the admin_config singleton PDA address
func (c *OracleClient) GetAdminConfigPDA() (sol.PublicKey, uint8, error) {
	pda, bump, err := sol.FindProgramAddress(
		[][]byte{
			[]byte("admin_config"),
		},
		c.programID,
	)
	if err != nil {
		return sol.PublicKey{}, 0, fmt.Errorf("failed to derive admin config PDA: %w", err)
	}
	return pda, bump, nil
}

// FetchAdminConfig fetches and decodes the admin config account from the chain
func (c *OracleClient) FetchAdminConfig(ctx context.Context) (*AdminConfig, error) {
	pda, _, err := c.GetAdminConfigPDA()
	if err != nil {
		return nil, err
	}

	var accountInfo *rpc.GetAccountInfoResult
	err = c.withFailover(ctx, func(client *rpc.Client) error {
		var err error
		accountInfo, err = client.GetAccountInfo(ctx, pda)
		return err
	})
	if err != nil {
		return nil, fmt.Errorf("failed to fetch admin config account: %w", err)
	}

	if accountInfo == nil || accountInfo.Value == nil {
		return nil, fmt.Errorf("admin config account not found - needs to be initialized")
	}

	data := accountInfo.Value.Data.GetBinary()
	if len(data) < AdminConfigLen {
		return nil, fmt.Errorf("account data too short for admin config")
	}

	// Skip 8-byte discriminator
	data = data[8:]

	adminConfig := &AdminConfig{
		Admin:        sol.PublicKeyFromBytes(data[0:32]),
		PendingAdmin: sol.PublicKeyFromBytes(data[32:64]),
		CreatedAt:    int64(bytesToUint64(data[64:72])),
		UpdatedAt:    int64(bytesToUint64(data[72:80])),
		Bump:         data[80],
	}

	return adminConfig, nil
}

// IsAdmin checks if the given public key is the current admin
func (c *OracleClient) IsAdmin(ctx context.Context, pubkey sol.PublicKey) (bool, error) {
	adminConfig, err := c.FetchAdminConfig(ctx)
	if err != nil {
		return false, err
	}
	return adminConfig.Admin.Equals(pubkey), nil
}

// GetDisputePDA derives the dispute PDA address for an escrow
func (c *OracleClient) GetDisputePDA(escrowPDA sol.PublicKey) (sol.PublicKey, uint8, error) {
	pda, bump, err := sol.FindProgramAddress(
		[][]byte{
			[]byte("dispute"),
			escrowPDA.Bytes(),
		},
		c.programID,
	)
	if err != nil {
		return sol.PublicKey{}, 0, fmt.Errorf("failed to derive dispute PDA: %w", err)
	}
	return pda, bump, nil
}

// ============== PRECISION HELPERS ==============

// LamportsPerSOL is the number of lamports in 1 SOL
const LamportsPerSOL uint64 = 1_000_000_000

// LamportsToSOL converts lamports to SOL as a float
func LamportsToSOL(lamports uint64) float64 {
	return float64(lamports) / float64(LamportsPerSOL)
}

// SOLToLamports converts SOL to lamports using rounded fixed-point math.
func SOLToLamports(sol float64) uint64 {
	if sol <= 0 {
		return 0
	}
	return uint64(math.Round(sol * float64(LamportsPerSOL)))
}

// CalculateProportionalPayout calculates payout using fixed-point arithmetic
// Returns (sellerPayout, buyerRefund)
func CalculateProportionalPayout(totalAmount, usedGB, limitGB uint64) (uint64, uint64) {
	if limitGB == 0 {
		return 0, totalAmount
	}

	// Cap usage at limit
	cappedUsage := usedGB
	if cappedUsage > limitGB {
		cappedUsage = limitGB
	}

	// seller_payout = (amount * used) / limit
	sellerPayout := (totalAmount * cappedUsage) / limitGB
	buyerRefund := totalAmount - sellerPayout

	return sellerPayout, buyerRefund
}

// GBToBytes converts gigabytes to bytes
func GBToBytes(gb uint64) uint64 {
	return gb * 1024 * 1024 * 1024
}

// BytesToGB converts bytes to gigabytes
func BytesToGB(bytes uint64) uint64 {
	return bytes / (1024 * 1024 * 1024)
}

// PricePerGBToLamportsPerByte converts price per GB (in SOL) to lamports per byte
func PricePerGBToLamportsPerByte(pricePerGB float64) uint64 {
	lamportsPerGB := SOLToLamports(pricePerGB)
	// Divide by bytes in 1 GB
	return lamportsPerGB / GBToBytes(1)
}

// ============== NFT ACCESS CONTROL ==============

// HasNFT checks if a wallet holds a specific NFT/Token mint
// limit 1 for now, as passes are usually 1
func (c *OracleClient) HasNFT(ctx context.Context, wallet sol.PublicKey, mint sol.PublicKey) (bool, error) {
	// Find associated token account
	ata, _, err := sol.FindAssociatedTokenAddress(wallet, mint)
	if err != nil {
		return false, fmt.Errorf("failed to derive ATA: %w", err)
	}

	// Fetch account info
	var accountInfo *rpc.GetAccountInfoResult
	err = c.withFailover(ctx, func(client *rpc.Client) error {
		var err error
		accountInfo, err = client.GetAccountInfo(ctx, ata)
		return err
	})
	if err != nil {
		// If account doesn't exist, they don't have it
		return false, nil
	}

	if accountInfo == nil || accountInfo.Value == nil {
		return false, nil
	}

	// Parse token data manually to avoid full dependency bloat if simple
	// Layout: mint(32) + owner(32) + amount(8) + ...
	data := accountInfo.Value.Data.GetBinary()
	if len(data) < 72 {
		return false, nil
	}

	amount := bytesToUint64(data[64:72])
	return amount > 0, nil
}

// ============== BRIDGE VERIFICATION ==============

func isTxNotFoundErr(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "not found") ||
		strings.Contains(msg, "was not found") ||
		strings.Contains(msg, "could not find")
}

// VerifyTransaction checks if a transaction is confirmed and transfers SOL to a destination.
// Uses commitment "confirmed" (matches wallet confirmTransaction) and retries briefly while
// public RPCs catch up — finalized-only lookups commonly return "not found" right after send.
func (c *OracleClient) VerifyTransaction(ctx context.Context, signature string, expectedDest sol.PublicKey) (uint64, error) {
	sig, err := sol.SignatureFromBase58(signature)
	if err != nil {
		return 0, fmt.Errorf("invalid signature: %w", err)
	}

	maxVersion := uint64(0)
	opts := &rpc.GetTransactionOpts{
		Commitment:                     rpc.CommitmentConfirmed,
		MaxSupportedTransactionVersion: &maxVersion,
	}

	const (
		maxAttempts = 12
		retryDelay  = 1500 * time.Millisecond
	)

	var tx *rpc.GetTransactionResult
	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		if ctx.Err() != nil {
			return 0, ctx.Err()
		}
		tx = nil
		lastErr = c.withFailover(ctx, func(client *rpc.Client) error {
			var err error
			tx, err = client.GetTransaction(ctx, sig, opts)
			return err
		})
		if lastErr == nil && tx != nil {
			break
		}
		if lastErr != nil && !isTxNotFoundErr(lastErr) {
			return 0, fmt.Errorf("failed to fetch transaction: %w", lastErr)
		}
		if attempt == maxAttempts {
			if lastErr != nil {
				return 0, fmt.Errorf("failed to fetch transaction: %w", lastErr)
			}
			return 0, fmt.Errorf("transaction not found")
		}
		select {
		case <-ctx.Done():
			return 0, ctx.Err()
		case <-time.After(retryDelay):
		}
	}

	if tx == nil {
		return 0, fmt.Errorf("transaction not found")
	}

	if tx.Meta == nil {
		return 0, fmt.Errorf("transaction meta missing")
	}
	if tx.Meta.Err != nil {
		return 0, fmt.Errorf("transaction failed on-chain")
	}

	// Decode transaction object
	decodedTx, err := tx.Transaction.GetTransaction()
	if err != nil {
		return 0, fmt.Errorf("failed to decode transaction: %w", err)
	}

	// Find index of expectedDest (legacy account keys + any loaded addresses)
	destIndex := -1
	for i, key := range decodedTx.Message.AccountKeys {
		if key.Equals(expectedDest) {
			destIndex = i
			break
		}
	}
	if destIndex == -1 && tx.Meta.LoadedAddresses.Writable != nil {
		offset := len(decodedTx.Message.AccountKeys)
		for i, key := range tx.Meta.LoadedAddresses.Writable {
			if key.Equals(expectedDest) {
				destIndex = offset + i
				break
			}
		}
	}
	if destIndex == -1 && tx.Meta.LoadedAddresses.ReadOnly != nil {
		offset := len(decodedTx.Message.AccountKeys) + len(tx.Meta.LoadedAddresses.Writable)
		for i, key := range tx.Meta.LoadedAddresses.ReadOnly {
			if key.Equals(expectedDest) {
				destIndex = offset + i
				break
			}
		}
	}

	if destIndex == -1 {
		return 0, fmt.Errorf("destination not found in transaction")
	}

	// Calculate balance change
	// Note: AccountKeys order aligns with Pre/PostBalances
	if destIndex >= len(tx.Meta.PreBalances) || destIndex >= len(tx.Meta.PostBalances) {
		return 0, fmt.Errorf("balance data not available for destination")
	}

	preBalance := tx.Meta.PreBalances[destIndex]
	postBalance := tx.Meta.PostBalances[destIndex]

	if postBalance <= preBalance {
		return 0, fmt.Errorf("no net positive transfer to destination")
	}

	return uint64(postBalance - preBalance), nil
}

// GetTransaction fetches a transaction by signature
func (c *OracleClient) GetTransaction(ctx context.Context, signature string) (*rpc.GetTransactionResult, error) {
	sig, err := sol.SignatureFromBase58(signature)
	if err != nil {
		return nil, fmt.Errorf("invalid signature: %w", err)
	}

	maxVersion := uint64(0)
	var tx *rpc.GetTransactionResult
	err = c.withFailover(ctx, func(client *rpc.Client) error {
		var err error
		tx, err = client.GetTransaction(ctx, sig, &rpc.GetTransactionOpts{
			Commitment:                     rpc.CommitmentConfirmed,
			Encoding:                       sol.EncodingBase64,
			MaxSupportedTransactionVersion: &maxVersion,
		})
		return err
	})
	if err != nil {
		return nil, fmt.Errorf("failed to fetch transaction: %w", err)
	}

	return tx, nil
}

// Global oracle client instance
var globalOracleClient *OracleClient

// InitOracleClient initializes the global oracle client
func InitOracleClient(cfg Config) error {
	client, err := NewOracleClient(cfg)
	if err != nil {
		return err
	}
	globalOracleClient = client
	return nil
}

// GetOracleClient returns the global oracle client instance
func GetOracleClient() *OracleClient {
	return globalOracleClient
}

// SetOracleClientForTest installs a stub oracle for integration tests.
func SetOracleClientForTest(c *OracleClient) {
	globalOracleClient = c
}

// RegisterOracleClient installs the production oracle (velocity guard, billing hooks, etc.)
// for all handlers that call GetOracleClient / GetOracle.
func RegisterOracleClient(c *OracleClient) {
	globalOracleClient = c
	oracleClient = c
}

// GetDepositDestinationAddress returns the address users should send SOL to.
// When PROXYHUB_DEPOSIT_VAULT_UI is on and vault is configured, returns the vault;
// otherwise returns the legacy treasury address.
func GetDepositDestinationAddress() string {
	if decentralization.DepositVaultUIEnabled() {
		if v := GetDepositVaultAddress(); v != "" {
			return v
		}
	}
	return GetTreasuryAddress()
}

// GetTreasuryAddress returns the configured treasury address from environment
func GetTreasuryAddress() string {
	return os.Getenv("SOLANA_TREASURY_ADDRESS")
}
