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

	sol "github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"
)

const (
	// DefaultProgramID is the ProxyHub Anchor program on devnet — overridden by SOLANA_PROGRAM_ID env var.
	DefaultProgramID = "2yDRyTwhHnVakKKMhhGG61V9b78RUdXRjAL3UiPwmDd7"

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
	hsm        HSMSigner
	network    string
	velocity   *VelocityGuard // nil until SetVelocityGuard is called
}

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
	// Path to oracle keypair JSON file
	OracleKeypairPath string
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

	if os.Getenv("USE_AWS_KMS") == "true" {
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

	cfg.RPCEndpoints = NormalizeRPCEndpoints(cfg.RPCEndpoints)
	if len(cfg.RPCEndpoints) == 0 {
		return nil, fmt.Errorf("no RPC endpoints provided")
	}

	// Create RPC clients
	rpcClients := make([]*rpc.Client, len(cfg.RPCEndpoints))
	for i, endpoint := range cfg.RPCEndpoints {
		rpcClients[i] = NewRPCClient(endpoint)
	}

	return &OracleClient{
		rpcClients: rpcClients,
		currentIdx: 0,
		programID:  programID,
		oracleKey:  oracleKey,
		hsm:        hsm,
		network:    cfg.Network,
	}, nil
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

// SignMessage signs arbitrary message bytes using the oracle's HSM or private key.
func (c *OracleClient) SignMessage(ctx context.Context, message []byte) ([]byte, error) {
	if c.hsm != nil {
		return c.hsm.Sign(ctx, message)
	}
	return ed25519.Sign(ed25519.PrivateKey(c.oracleKey), message), nil
}

// SignTransaction signs a Solana transaction using the oracle's HSM or private key.
func (c *OracleClient) SignTransaction(ctx context.Context, tx *sol.Transaction) error {
	if c.hsm != nil {
		msgBytes, err := tx.Message.MarshalBinary()
		if err != nil {
			return fmt.Errorf("failed to marshal transaction message: %w", err)
		}
		sigBytes, err := c.hsm.Sign(ctx, msgBytes)
		if err != nil {
			return fmt.Errorf("failed to sign with HSM: %w", err)
		}

		var signature sol.Signature
		copy(signature[:], sigBytes)

		oraclePubkey := c.hsm.PublicKey()
		signerIndex := -1
		for i, key := range tx.Message.AccountKeys {
			if key.Equals(oraclePubkey) {
				signerIndex = i
				break
			}
		}
		if signerIndex == -1 || signerIndex >= int(tx.Message.Header.NumRequiredSignatures) {
			return fmt.Errorf("oracle public key not found as signer in transaction")
		}

		if len(tx.Signatures) <= signerIndex {
			newSigs := make([]sol.Signature, tx.Message.Header.NumRequiredSignatures)
			copy(newSigs, tx.Signatures)
			tx.Signatures = newSigs
		}
		tx.Signatures[signerIndex] = signature
		return nil
	}

	_, err := tx.Sign(func(key sol.PublicKey) *sol.PrivateKey {
		if key.Equals(c.oracleKey.PublicKey()) {
			return &c.oracleKey
		}
		return nil
	})
	return err
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
	// Named constants replace magic numbers so a future IDL change has one place to update.
	// Layout: buyer(32) seller(32) amount(u64) bw_limit(u64) bw_used(u64) status(u8) created(i64) expires(i64) bump(u8)
	const (
		escrowOffBuyer            = 0
		escrowOffSeller           = 32
		escrowOffAmount           = 64
		escrowOffBandwidthLimitGB = 72
		escrowOffBandwidthUsedGB  = 80
		escrowOffStatus           = 88
		escrowOffCreatedAt        = 89
		escrowOffExpiresAt        = 97
		escrowOffBump             = 105
		escrowMinSize             = 106 // bump byte + 1
	)

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
		ExpiresAt:        int64(bytesToUint64(data[escrowOffExpiresAt:escrowOffBump])),
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

// GetBalance returns the SOL balance of the specified wallet
func (c *OracleClient) GetBalance(ctx context.Context, pubkey sol.PublicKey) (uint64, error) {
	var balance *rpc.GetBalanceResult
	err := c.withFailover(ctx, func(client *rpc.Client) error {
		var err error
		balance, err = client.GetBalance(ctx, pubkey, rpc.CommitmentFinalized)
		return err
	})
	if err != nil {
		return 0, fmt.Errorf("failed to get balance: %w", err)
	}
	return balance.Value, nil
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

// VerifyTransaction checks if a transaction is finalized and transfers SOL to a destination
func (c *OracleClient) VerifyTransaction(ctx context.Context, signature string, expectedDest sol.PublicKey) (uint64, error) {
	sig, err := sol.SignatureFromBase58(signature)
	if err != nil {
		return 0, fmt.Errorf("invalid signature: %w", err)
	}

	var tx *rpc.GetTransactionResult
	err = c.withFailover(ctx, func(client *rpc.Client) error {
		var err error
		tx, err = client.GetTransaction(ctx, sig, &rpc.GetTransactionOpts{
			Commitment: rpc.CommitmentFinalized,
		})
		return err
	})
	if err != nil {
		return 0, fmt.Errorf("failed to fetch transaction: %w", err)
	}

	if tx == nil {
		return 0, fmt.Errorf("transaction not found")
	}

	if tx.Meta.Err != nil {
		return 0, fmt.Errorf("transaction failed on-chain")
	}

	// Decode transaction object
	decodedTx, err := tx.Transaction.GetTransaction()
	if err != nil {
		return 0, fmt.Errorf("failed to decode transaction: %w", err)
	}

	// Find index of expectedDest
	destIndex := -1
	for i, key := range decodedTx.Message.AccountKeys {
		if key.Equals(expectedDest) {
			destIndex = i
			break
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

	var tx *rpc.GetTransactionResult
	err = c.withFailover(ctx, func(client *rpc.Client) error {
		var err error
		tx, err = client.GetTransaction(ctx, sig, &rpc.GetTransactionOpts{
			Commitment: rpc.CommitmentFinalized,
			Encoding:   sol.EncodingBase64,
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

// GetTreasuryAddress returns the configured treasury address from environment
func GetTreasuryAddress() string {
	return os.Getenv("SOLANA_TREASURY_ADDRESS")
}
