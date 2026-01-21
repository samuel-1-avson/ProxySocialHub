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
