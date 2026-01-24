// Package solana provides Solana blockchain integration for the ProxyHub oracle.
// It handles escrow settlement, refunds, and on-chain event monitoring.
package solana

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"
)

const (
	// Program ID for the ProxyHub Anchor program (devnet)
	ProgramID = "2yDRyTwhHnVakKKMhhGG61V9b78RUdXRjAL3UiPwmDd7"

	// Escrow account discriminator (first 8 bytes of sha256("account:Escrow"))
	EscrowDiscriminator = "b8e2f40c"
)

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
	rpcClient *rpc.Client
	programID sol.PublicKey
	oracleKey sol.PrivateKey
	network   string
}

// Config holds the Solana client configuration
type Config struct {
	// RPC endpoint (e.g., https://api.devnet.solana.com)
	RPCEndpoint string
	// Path to oracle keypair JSON file
	OracleKeypairPath string
	// Network name for logging (devnet, mainnet-beta)
	Network string
}

// NewOracleClient creates a new Solana oracle client
func NewOracleClient(cfg Config) (*OracleClient, error) {
	// Parse program ID
	programID, err := sol.PublicKeyFromBase58(ProgramID)
	if err != nil {
		return nil, fmt.Errorf("invalid program ID: %w", err)
	}

	// Load oracle keypair
	oracleKey, err := loadKeypair(cfg.OracleKeypairPath)
	if err != nil {
		return nil, fmt.Errorf("failed to load oracle keypair: %w", err)
	}

	// Create RPC client
	rpcClient := rpc.New(cfg.RPCEndpoint)

	return &OracleClient{
		rpcClient: rpcClient,
		programID: programID,
		oracleKey: oracleKey,
		network:   cfg.Network,
	}, nil
}

// loadKeypair loads a Solana keypair from a JSON file
func loadKeypair(path string) (sol.PrivateKey, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read keypair file: %w", err)
	}

	var keypairBytes []byte
	if err := json.Unmarshal(data, &keypairBytes); err != nil {
		return nil, fmt.Errorf("failed to parse keypair JSON: %w", err)
	}

	if len(keypairBytes) != 64 {
		return nil, fmt.Errorf("invalid keypair length: expected 64, got %d", len(keypairBytes))
	}

	return sol.PrivateKey(keypairBytes), nil
}

// GetOraclePublicKey returns the oracle's public key
func (c *OracleClient) GetOraclePublicKey() sol.PublicKey {
	return c.oracleKey.PublicKey()
}

// GetNetwork returns the current network (devnet, mainnet-beta, etc)
func (c *OracleClient) GetNetwork() string {
	return c.network
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

// FetchEscrow fetches and decodes an escrow account from the chain
func (c *OracleClient) FetchEscrow(ctx context.Context, escrowPDA sol.PublicKey) (*Escrow, error) {
	accountInfo, err := c.rpcClient.GetAccountInfo(ctx, escrowPDA)
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

	// Decode escrow (manual parsing - matches Anchor layout)
	if len(data) < 114 { // 32+32+8+8+8+1+8+8+1 = 106 minimum
		return nil, fmt.Errorf("account data too short for escrow")
	}

	escrow := &Escrow{
		Buyer:            sol.PublicKeyFromBytes(data[0:32]),
		Seller:           sol.PublicKeyFromBytes(data[32:64]),
		Amount:           bytesToUint64(data[64:72]),
		BandwidthLimitGB: bytesToUint64(data[72:80]),
		BandwidthUsedGB:  bytesToUint64(data[80:88]),
		Status:           EscrowStatus(data[88]),
		CreatedAt:        int64(bytesToUint64(data[89:97])),
		ExpiresAt:        int64(bytesToUint64(data[97:105])),
		Bump:             data[105],
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

// GetBalance returns the SOL balance of the oracle wallet
func (c *OracleClient) GetBalance(ctx context.Context) (uint64, error) {
	balance, err := c.rpcClient.GetBalance(ctx, c.oracleKey.PublicKey(), rpc.CommitmentFinalized)
	if err != nil {
		return 0, fmt.Errorf("failed to get balance: %w", err)
	}
	return balance.Value, nil
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

	accountInfo, err := c.rpcClient.GetAccountInfo(ctx, pda)
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

// SOLToLamports converts SOL to lamports
func SOLToLamports(sol float64) uint64 {
	return uint64(sol * float64(LamportsPerSOL))
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
	accountInfo, err := c.rpcClient.GetAccountInfo(ctx, ata)
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

	// Fetch transaction
	// MaxRetries: nil (default)
	tx, err := c.rpcClient.GetTransaction(ctx, sig, &rpc.GetTransactionOpts{
		Commitment: rpc.CommitmentFinalized,
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
