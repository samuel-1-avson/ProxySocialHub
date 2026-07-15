// Package solana - Multi-Sig Oracle Client for Decentralized Settlements
package solana

import (
	"context"
	"fmt"
	"sort"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"
)

// MultiSigConfig represents the on-chain multi-sig oracle configuration
type MultiSigConfig struct {
	Signers   []sol.PublicKey
	Threshold uint8
	Nonce     uint64
	LastUpdate int64
}

// SettlementSignature represents an oracle signature for settlement
type SettlementSignature struct {
	Signer    sol.PublicKey
	Signature [64]byte
	Timestamp int64
}

// MultiSigOracleClient extends OracleClient with multi-sig capabilities
type MultiSigOracleClient struct {
	*OracleClient
	config       *MultiSigConfig
	signers      []sol.PrivateKey // This oracle's signing keys
	isSigner     bool             // Whether this client is an authorized signer
}

// MultiSigSettlementRequest contains all data needed for multi-sig settlement
type MultiSigSettlementRequest struct {
	EscrowPDA       sol.PublicKey
	Buyer           sol.PublicKey
	Seller          sol.PublicKey
	BandwidthUsedGB uint64
	Nonce           uint64
}

// NewMultiSigOracleClient creates a new multi-sig enabled oracle client
func NewMultiSigOracleClient(baseClient *OracleClient) (*MultiSigOracleClient, error) {
	return &MultiSigOracleClient{
		OracleClient: baseClient,
		signers:      make([]sol.PrivateKey, 0),
		isSigner:     false,
	}, nil
}

// AddSignerKey adds a private key for signing settlements
// In production, these should be in HSM/separate secure storage
func (m *MultiSigOracleClient) AddSignerKey(key sol.PrivateKey) {
	m.signers = append(m.signers, key)
}

// LoadMultiSigConfig fetches the current multi-sig configuration from chain
func (m *MultiSigOracleClient) LoadMultiSigConfig(ctx context.Context) error {
	// Derive the multi-sig oracle PDA
	pda, _, err := sol.FindProgramAddress(
		[][]byte{[]byte("multisig_oracle")},
		m.programID,
	)
	if err != nil {
		return fmt.Errorf("failed to derive multisig PDA: %w", err)
	}

	// Fetch account data
	var accountInfo *rpc.GetAccountInfoResult
	err = m.withFailover(ctx, func(client *rpc.Client) error {
		var err error
		accountInfo, err = client.GetAccountInfo(ctx, pda)
		return err
	})
	if err != nil {
		return fmt.Errorf("failed to fetch multisig config: %w", err)
	}

	if accountInfo == nil || accountInfo.Value == nil {
		return fmt.Errorf("multisig oracle not initialized")
	}

	// Parse account data (skip 8-byte discriminator)
	data := accountInfo.Value.Data.GetBinary()
	if len(data) < 8+4+(32*5)+1+8+8+1 {
		return fmt.Errorf("multisig account data too short")
	}

	data = data[8:] // Skip discriminator

	// Parse signers vector
	m.config = &MultiSigConfig{}
	
	// Number of signers (u32)
	numSigners := uint32(data[0]) | uint32(data[1])<<8 | uint32(data[2])<<16 | uint32(data[3])<<24
	if numSigners > 5 {
		return fmt.Errorf("invalid multisig signers count: %d (max 5)", numSigners)
	}
	data = data[4:]

	// Parse each signer
	for i := 0; i < int(numSigners) && i < 5; i++ {
		if len(data) < 32 {
			break
		}
		pubkey := sol.PublicKeyFromBytes(data[:32])
		m.config.Signers = append(m.config.Signers, pubkey)
		data = data[32:]
	}

	// Skip remaining space in vector (5 - numSigners) * 32
	data = data[(5-int(numSigners))*32:]

	// Parse threshold
	m.config.Threshold = data[0]
	data = data[1:]

	// Parse nonce
	m.config.Nonce = bytesToUint64(data[:8])
	data = data[8:]

	// Parse last_update
	m.config.LastUpdate = int64(bytesToUint64(data[:8]))

	// Check if this client is a signer
	m.isSigner = false
	for _, signerKey := range m.signers {
		for _, authorizedSigner := range m.config.Signers {
			if signerKey.PublicKey().Equals(authorizedSigner) {
				m.isSigner = true
				break
			}
		}
	}

	return nil
}

// SignSettlement creates an Ed25519 signature for a settlement
func (m *MultiSigOracleClient) SignSettlement(
	req MultiSigSettlementRequest,
	signerKey sol.PrivateKey,
) (*SettlementSignature, error) {
	if m.config == nil {
		return nil, fmt.Errorf("multisig config not loaded")
	}

	// Verify signer is authorized
	signerPub := signerKey.PublicKey()
	isAuthorized := false
	for _, auth := range m.config.Signers {
		if signerPub.Equals(auth) {
			isAuthorized = true
			break
		}
	}
	if !isAuthorized {
		return nil, fmt.Errorf("signer %s is not authorized", signerPub.String())
	}

	// Create canonical message
	// Format: "settle:{escrow}:{buyer}:{seller}:{usage}:{nonce}"
	msg := fmt.Sprintf(
		"settle:%s:%s:%s:%d:%d",
		req.EscrowPDA.String(),
		req.Buyer.String(),
		req.Seller.String(),
		req.BandwidthUsedGB,
		req.Nonce,
	)

	// Sign the message
	signature, err := signerKey.Sign([]byte(msg))
	if err != nil {
		return nil, fmt.Errorf("failed to sign message: %w", err)
	}

	// Convert signature to [64]byte
	var sigBytes [64]byte
	copy(sigBytes[:], signature[:])

	return &SettlementSignature{
		Signer:    signerPub,
		Signature: sigBytes,
		Timestamp: 0, // Will be set by caller
	}, nil
}

// VerifySettlementSignature verifies an oracle's settlement signature
func (m *MultiSigOracleClient) VerifySettlementSignature(
	req MultiSigSettlementRequest,
	sig *SettlementSignature,
) error {
	if m.config == nil {
		return fmt.Errorf("multisig config not loaded")
	}

	// Verify signer is in the authorized list
	isAuthorized := false
	for _, auth := range m.config.Signers {
		if sig.Signer.Equals(auth) {
			isAuthorized = true
			break
		}
	}
	if !isAuthorized {
		return fmt.Errorf("signer %s is not authorized", sig.Signer.String())
	}

	// Reconstruct message
	msg := fmt.Sprintf(
		"settle:%s:%s:%s:%d:%d",
		req.EscrowPDA.String(),
		req.Buyer.String(),
		req.Seller.String(),
		req.BandwidthUsedGB,
		req.Nonce,
	)

	// Verify Ed25519 signature
	if !sig.Signer.Verify([]byte(msg), sig.Signature) {
		return fmt.Errorf("signature verification failed")
	}

	return nil
}

// AggregateSettlementSignatures collects and validates multiple signatures
func (m *MultiSigOracleClient) AggregateSettlementSignatures(
	req MultiSigSettlementRequest,
	sigs []*SettlementSignature,
) ([]sol.PublicKey, error) {
	if m.config == nil {
		return nil, fmt.Errorf("multisig config not loaded")
	}

	if len(sigs) < int(m.config.Threshold) {
		return nil, fmt.Errorf(
			"insufficient signatures: got %d, need %d",
			len(sigs),
			m.config.Threshold,
		)
	}

	// Verify all signatures and check for duplicates
	seenSigners := make(map[string]bool)
	validSigners := make([]sol.PublicKey, 0, len(sigs))

	for _, sig := range sigs {
		signerStr := sig.Signer.String()
		
		// Check for duplicate
		if seenSigners[signerStr] {
			return nil, fmt.Errorf("duplicate signature from %s", signerStr)
		}
		seenSigners[signerStr] = true

		// Verify signature
		if err := m.VerifySettlementSignature(req, sig); err != nil {
			return nil, fmt.Errorf("invalid signature from %s: %w", signerStr, err)
		}

		validSigners = append(validSigners, sig.Signer)
	}

	// Sort signers for deterministic on-chain verification
	sort.Slice(validSigners, func(i, j int) bool {
		return validSigners[i].String() < validSigners[j].String()
	})

	return validSigners, nil
}

// SettleEscrowMultiSig submits a settlement with multi-sig verification
func (m *MultiSigOracleClient) SettleEscrowMultiSig(
	ctx context.Context,
	params SettleEscrowParams,
	sigs []*SettlementSignature,
) (string, error) {
	if m.config == nil {
		return "", fmt.Errorf("multisig config not loaded")
	}

	// Build settlement request
	req := MultiSigSettlementRequest{
		EscrowPDA:       params.EscrowPDA,
		Buyer:           params.Buyer,
		Seller:          params.Seller,
		BandwidthUsedGB: params.BandwidthUsedGB,
		Nonce:           m.config.Nonce,
	}

	// Aggregate and verify signatures
	signers, err := m.AggregateSettlementSignatures(req, sigs)
	if err != nil {
		return "", fmt.Errorf("signature aggregation failed: %w", err)
	}

	// Build the settle_escrow_multisig instruction
	instruction := m.buildMultiSigSettleInstruction(params, signers)

	// Get recent blockhash
	var recentBlockhash *rpc.GetLatestBlockhashResult
	err = m.withFailover(ctx, func(client *rpc.Client) error {
		var err error
		recentBlockhash, err = client.GetLatestBlockhash(ctx, rpc.CommitmentFinalized)
		return err
	})
	if err != nil {
		return "", fmt.Errorf("failed to get recent blockhash: %w", err)
	}

	// Sort sigs to align with deterministic sorted signers list
	sort.Slice(sigs, func(i, j int) bool {
		return sigs[i].Signer.String() < sigs[j].Signer.String()
	})

	var instructions []sol.Instruction

	// Build Ed25519 precompile instructions for each signature up to the threshold
	threshold := int(m.config.Threshold)
	for i := 0; i < len(sigs) && i < threshold; i++ {
		sig := sigs[i]
		msg := fmt.Sprintf(
			"settle:%s:%s:%s:%d:%d",
			req.EscrowPDA.String(),
			req.Buyer.String(),
			req.Seller.String(),
			req.BandwidthUsedGB,
			req.Nonce,
		)

		precompileIx, err := createEd25519Instruction(sig.Signer, sig.Signature, []byte(msg))
		if err != nil {
			return "", fmt.Errorf("failed to create Ed25519 precompile instruction: %w", err)
		}
		instructions = append(instructions, precompileIx)
	}

	// Append main settle_escrow_multisig instruction
	instructions = append(instructions, instruction)

	// Build transaction
	tx, err := sol.NewTransaction(
		instructions,
		recentBlockhash.Value.Blockhash,
		sol.TransactionPayer(m.GetOraclePublicKey()),
	)
	if err != nil {
		return "", fmt.Errorf("failed to build transaction: %w", err)
	}

	// Sign with oracle key
	err = m.SignTransaction(ctx, tx)
	if err != nil {
		return "", fmt.Errorf("failed to sign transaction: %w", err)
	}

	// Send transaction
	var sig sol.Signature
	err = m.withFailover(ctx, func(client *rpc.Client) error {
		var err error
		sig, err = client.SendTransaction(ctx, tx)
		return err
	})
	if err != nil {
		return "", fmt.Errorf("failed to send transaction: %w", err)
	}

	return sig.String(), nil
}

// buildMultiSigSettleInstruction creates the settle_escrow_multisig instruction
func (m *MultiSigOracleClient) buildMultiSigSettleInstruction(
	params SettleEscrowParams,
	signers []sol.PublicKey,
) sol.Instruction {
	// Derive PDAs
	multisigPDA, _, _ := sol.FindProgramAddress(
		[][]byte{[]byte("multisig_oracle")},
		m.programID,
	)

	statePDA, _, _ := sol.FindProgramAddress(
		[][]byte{[]byte("program_state")},
		m.programID,
	)

	nonceBytes := make([]byte, 8)
	for i := 0; i < 8; i++ {
		nonceBytes[i] = byte(m.config.Nonce >> (8 * i))
	}
	oracleSigPDA, _, _ := sol.FindProgramAddress(
		[][]byte{
			[]byte("oracle_sig"),
			params.EscrowPDA.Bytes(),
			nonceBytes,
		},
		m.programID,
	)

	// Instruction discriminator for "settle_escrow_multisig"
	// First 8 bytes of sha256("global:settle_escrow_multisig")
	discriminator := []byte{211, 136, 78, 235, 181, 247, 45, 77}

	// Encode data
	// discriminator (8) + bandwidth_used_gb (8) + num_signers (4) + signers (32*num)
	data := make([]byte, 8+8+4+len(signers)*32)
	copy(data[0:8], discriminator)
	
	// Encode bandwidth
	for i := 0; i < 8; i++ {
		data[8+i] = byte(params.BandwidthUsedGB >> (8 * i))
	}
	
	// Encode number of signers
	numSigners := uint32(len(signers))
	for i := 0; i < 4; i++ {
		data[16+i] = byte(numSigners >> (8 * i))
	}
	
	// Encode signers
	offset := 20
	for _, signer := range signers {
		copy(data[offset:offset+32], signer.Bytes())
		offset += 32
	}

	return &GenericInstruction{
		programID: m.programID,
		accounts: []*sol.AccountMeta{
			{PublicKey: params.EscrowPDA, IsSigner: false, IsWritable: true},
			{PublicKey: params.Buyer, IsSigner: false, IsWritable: true},
			{PublicKey: params.Seller, IsSigner: false, IsWritable: true},
			{PublicKey: multisigPDA, IsSigner: false, IsWritable: false},
			{PublicKey: oracleSigPDA, IsSigner: false, IsWritable: true},
			{PublicKey: m.GetOraclePublicKey(), IsSigner: true, IsWritable: true},
			{PublicKey: statePDA, IsSigner: false, IsWritable: false},
			{PublicKey: sol.SystemProgramID, IsSigner: false, IsWritable: false},
			{PublicKey: sol.SysVarInstructionsPubkey, IsSigner: false, IsWritable: false},
		},
		data: data,
	}
}

// IsAuthorizedSigner checks if this client can sign settlements
func (m *MultiSigOracleClient) IsAuthorizedSigner() bool {
	return m.isSigner
}

// GetThreshold returns the current signature threshold
func (m *MultiSigOracleClient) GetThreshold() uint8 {
	if m.config == nil {
		return 0
	}
	return m.config.Threshold
}

// GetSigners returns the list of authorized signers
func (m *MultiSigOracleClient) GetSigners() []sol.PublicKey {
	if m.config == nil {
		return nil
	}
	return m.config.Signers
}

// Global multi-sig oracle client instance
var globalMultiSigOracle *MultiSigOracleClient

// InitMultiSigOracle initializes the global multi-sig oracle client
func InitMultiSigOracle(baseClient *OracleClient) error {
	client, err := NewMultiSigOracleClient(baseClient)
	if err != nil {
		return err
	}
	globalMultiSigOracle = client
	return nil
}

// GetMultiSigOracle returns the global multi-sig oracle client
func GetMultiSigOracle() *MultiSigOracleClient {
	return globalMultiSigOracle
}

func createEd25519Instruction(pubkey sol.PublicKey, signature [64]byte, message []byte) (sol.Instruction, error) {
	pubkeyBytes := pubkey.Bytes()
	msgLen := len(message)

	data := make([]byte, 16 + 32 + 64 + msgLen)

	// num_signatures
	data[0] = 1
	// padding
	data[1] = 0

	// signature_offset (48)
	data[2] = 48
	data[3] = 0
	// signature_instruction_index (0xffff)
	data[4] = 255
	data[5] = 255

	// public_key_offset (16)
	data[6] = 16
	data[7] = 0
	// public_key_instruction_index (0xffff)
	data[8] = 255
	data[9] = 255

	// message_data_offset (112)
	data[10] = 112
	data[11] = 0
	// message_data_size
	data[12] = byte(msgLen)
	data[13] = byte(msgLen >> 8)
	// message_instruction_index (0xffff)
	data[14] = 255
	data[15] = 255

	// Copy public key
	copy(data[16:48], pubkeyBytes)
	// Copy signature
	copy(data[48:112], signature[:])
	// Copy message
	copy(data[112:], message)

	programID := sol.MustPublicKeyFromBase58("Ed25519SigVerify111111111111111111111111111")

	return &GenericInstruction{
		programID: programID,
		accounts:  []*sol.AccountMeta{}, // Precompiles have no accounts
		data:      data,
	}, nil
}

