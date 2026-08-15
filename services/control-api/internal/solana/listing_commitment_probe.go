package solana

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"strings"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"
	"github.com/google/uuid"
)

const (
	// ListingCommitmentLogMarker is the msg! string compiled into the upgraded proxyhub ELF.
	ListingCommitmentLogMarker = "Listing commitment registered for provider"
	// ListingCommitmentAccountLen is ListingCommitment::LEN (disc + fields).
	ListingCommitmentAccountLen = 8 + 32 + 32 + 16 + 1 + 8 + 1
	listingCommitmentSeed       = "listing-commitment"
)

// ListingCommitmentData is the decoded on-chain ListingCommitment account.
type ListingCommitmentData struct {
	Provider      sol.PublicKey
	OfferHash     [32]byte
	ListingID     uuid.UUID
	IsActive      bool
	RegisteredAt  int64
	Bump          uint8
	AccountPubkey sol.PublicKey
}

// ListingCommitmentProbe reports whether live proxyhub bytecode includes ListingCommitment.
type ListingCommitmentProbe struct {
	ProgramID       string `json:"program_id"`
	Executable      bool   `json:"executable"`
	MarkerInELF     bool   `json:"marker_in_elf"`
	ExistingPDAs    int    `json:"existing_pdas"`
	IxStatus        string `json:"ix_status"` // ix_present | ix_absent | unknown
	Message         string `json:"message"`
	ProgramsSession string `json:"programs_session"`
}

func listingCommitmentAccountDisc() [8]byte {
	h := sha256.Sum256([]byte("account:ListingCommitment"))
	var disc [8]byte
	copy(disc[:], h[:8])
	return disc
}

// ParseListingCommitmentAccount decodes a ListingCommitment account (after existence checks).
func ParseListingCommitmentAccount(raw []byte) (*ListingCommitmentData, error) {
	if len(raw) < ListingCommitmentAccountLen {
		return nil, fmt.Errorf("listing commitment too short: %d bytes", len(raw))
	}
	want := listingCommitmentAccountDisc()
	if !bytes.Equal(raw[:8], want[:]) {
		return nil, fmt.Errorf("listing commitment discriminator mismatch")
	}
	var d ListingCommitmentData
	off := 8
	copy(d.Provider[:], raw[off:off+32])
	off += 32
	copy(d.OfferHash[:], raw[off:off+32])
	off += 32
	copy(d.ListingID[:], raw[off:off+16])
	off += 16
	d.IsActive = raw[off] != 0
	off++
	d.RegisteredAt = int64(binary.LittleEndian.Uint64(raw[off : off+8]))
	off += 8
	d.Bump = raw[off]
	return &d, nil
}

// BuildRegisterListingCommitmentInstruction builds the oracle register ix (does not send).
func BuildRegisterListingCommitmentInstruction(programID, oracle, provider sol.PublicKey, offerHash [32]byte, listingID uuid.UUID) (sol.Instruction, sol.PublicKey, error) {
	if offerHash == [32]byte{} {
		return nil, sol.PublicKey{}, fmt.Errorf("offer hash must be non-zero")
	}
	if programID.String() == UnsafeSessionProgramID {
		return nil, sol.PublicKey{}, fmt.Errorf("SOLANA_PROGRAM_ID must not be programs/session (%s)", UnsafeSessionProgramID)
	}
	commitmentPDA, _, err := ListingCommitmentPDA(programID, provider, offerHash)
	if err != nil {
		return nil, sol.PublicKey{}, err
	}
	statePDA, _, err := sol.FindProgramAddress([][]byte{[]byte("program_state")}, programID)
	if err != nil {
		return nil, sol.PublicKey{}, err
	}
	data := make([]byte, 8+32+32+16)
	copy(data[0:8], discRegisterListingCommitment[:])
	copy(data[8:40], provider.Bytes())
	copy(data[40:72], offerHash[:])
	copy(data[72:88], listingID[:])
	ix := &GenericInstruction{
		programID: programID,
		accounts: []*sol.AccountMeta{
			{PublicKey: commitmentPDA, IsSigner: false, IsWritable: true},
			{PublicKey: oracle, IsSigner: true, IsWritable: true},
			{PublicKey: statePDA, IsSigner: false, IsWritable: false},
			{PublicKey: sol.SystemProgramID, IsSigner: false, IsWritable: false},
		},
		data: data,
	}
	return ix, commitmentPDA, nil
}

// ClassifyListingCommitmentLogs maps simulate/send logs to ix_present / ix_absent / unknown.
func ClassifyListingCommitmentLogs(logs []string, errMsg string) string {
	joined := strings.Join(logs, "\n")
	if errMsg != "" {
		joined += "\n" + errMsg
	}
	lower := strings.ToLower(joined)
	if strings.Contains(lower, "instructionfallbacknotfound") ||
		strings.Contains(lower, "fallback functions are not supported") ||
		strings.Contains(lower, "invalid instruction data") && strings.Contains(lower, "fallthrough") {
		return "ix_absent"
	}
	if strings.Contains(joined, "RegisterListingCommitment") ||
		strings.Contains(joined, ListingCommitmentLogMarker) ||
		strings.Contains(lower, "unauthorized") ||
		strings.Contains(lower, "program is paused") ||
		strings.Contains(lower, "already in use") {
		return "ix_present"
	}
	return "unknown"
}

// ProbeListingCommitmentOnChain checks live proxyhub for ListingCommitment (read-only).
func ProbeListingCommitmentOnChain(ctx context.Context, rpcURL, programIDStr string) (ListingCommitmentProbe, error) {
	probe := ListingCommitmentProbe{
		ProgramID:       programIDStr,
		IxStatus:        "unknown",
		ProgramsSession: "unsafe_do_not_deploy",
	}
	if strings.TrimSpace(programIDStr) == UnsafeSessionProgramID {
		probe.IxStatus = "ix_absent"
		probe.Message = "refused: programs/session is not the listing-commitment vehicle"
		return probe, fmt.Errorf("SOLANA_PROGRAM_ID must not be programs/session")
	}
	programID, err := sol.PublicKeyFromBase58(programIDStr)
	if err != nil {
		probe.Message = "invalid program id"
		return probe, err
	}
	client := rpc.New(rpcURL)
	info, err := client.GetAccountInfoWithOpts(ctx, programID, &rpc.GetAccountInfoOpts{
		Encoding: sol.EncodingBase64,
	})
	if err != nil {
		probe.Message = fmt.Sprintf("getAccountInfo program: %v", err)
		return probe, err
	}
	if info == nil || info.Value == nil {
		probe.Message = "program account not found"
		return probe, fmt.Errorf("program not deployed")
	}
	probe.Executable = info.Value.Executable

	raw := info.Value.Data.GetBinary()
	elfFetched := false
	if markerInBytes(raw) {
		probe.MarkerInELF = true
		elfFetched = true
	}
	if dataPK, ok := upgradeableProgramDataAddress(raw); ok {
		dataInfo, err := client.GetAccountInfoWithOpts(ctx, dataPK, &rpc.GetAccountInfoOpts{
			Encoding: sol.EncodingBase64,
		})
		if err == nil && dataInfo != nil && dataInfo.Value != nil {
			elfFetched = true
			if markerInBytes(dataInfo.Value.Data.GetBinary()) {
				probe.MarkerInELF = true
			}
		}
	}

	disc := listingCommitmentAccountDisc()
	accts, err := client.GetProgramAccountsWithOpts(ctx, programID, &rpc.GetProgramAccountsOpts{
		Encoding: sol.EncodingBase64,
		Filters: []rpc.RPCFilter{
			{DataSize: uint64(ListingCommitmentAccountLen)},
			{Memcmp: &rpc.RPCFilterMemcmp{
				Offset: 0,
				Bytes:  sol.Base58(disc[:]),
			}},
		},
	})
	if err == nil {
		probe.ExistingPDAs = len(accts)
	}

	switch {
	case probe.MarkerInELF || probe.ExistingPDAs > 0:
		probe.IxStatus = "ix_present"
		probe.Message = "live proxyhub ELF contains ListingCommitment (or PDAs already exist)"
	case elfFetched && probe.Executable:
		probe.IxStatus = "ix_absent"
		probe.Message = "program is executable but ListingCommitment marker was not found in ELF — upgrade still pending"
	default:
		probe.IxStatus = "unknown"
		probe.Message = "could not fetch programdata ELF; ListingCommitment deploy status unknown"
	}
	return probe, nil
}

func markerInBytes(raw []byte) bool {
	return bytes.Contains(raw, []byte(ListingCommitmentLogMarker)) ||
		bytes.Contains(raw, []byte(listingCommitmentSeed))
}

func upgradeableProgramDataAddress(raw []byte) (sol.PublicKey, bool) {
	// Borsh enum Program { programdata_address } = 2u32 + 32 bytes.
	if len(raw) < 36 {
		return sol.PublicKey{}, false
	}
	variant := binary.LittleEndian.Uint32(raw[:4])
	if variant != 2 {
		return sol.PublicKey{}, false
	}
	var pk sol.PublicKey
	copy(pk[:], raw[4:36])
	return pk, true
}

// ReadListingCommitment fetches and decodes a ListingCommitment PDA.
func (c *OracleClient) ReadListingCommitment(ctx context.Context, provider sol.PublicKey, offerHash [32]byte) (*ListingCommitmentData, error) {
	pda, _, err := c.GetListingCommitmentPDA(provider, offerHash)
	if err != nil {
		return nil, err
	}
	var accountInfo *rpc.GetAccountInfoResult
	if err := c.withFailover(ctx, func(client *rpc.Client) error {
		var e error
		accountInfo, e = client.GetAccountInfo(ctx, pda)
		return e
	}); err != nil {
		return nil, fmt.Errorf("GetAccountInfo: %w", err)
	}
	if accountInfo == nil || accountInfo.Value == nil {
		return nil, fmt.Errorf("listing commitment not found at %s", pda)
	}
	d, err := ParseListingCommitmentAccount(accountInfo.Value.Data.GetBinary())
	if err != nil {
		return nil, err
	}
	d.AccountPubkey = pda
	return d, nil
}

// FetchListingCommitment is a read-only RPC lookup (no oracle keypair).
func FetchListingCommitment(ctx context.Context, rpcURL, programIDStr string, provider sol.PublicKey, offerHash [32]byte) (*ListingCommitmentData, error) {
	if strings.TrimSpace(programIDStr) == UnsafeSessionProgramID {
		return nil, fmt.Errorf("SOLANA_PROGRAM_ID must not be programs/session")
	}
	programID, err := sol.PublicKeyFromBase58(programIDStr)
	if err != nil {
		return nil, fmt.Errorf("program id: %w", err)
	}
	pda, _, err := ListingCommitmentPDA(programID, provider, offerHash)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(rpcURL) == "" {
		rpcURL = DefaultDevnetRPCEndpoint
	}
	client := rpc.New(rpcURL)
	info, err := client.GetAccountInfo(ctx, pda)
	if err != nil {
		return nil, fmt.Errorf("GetAccountInfo: %w", err)
	}
	if info == nil || info.Value == nil {
		return nil, fmt.Errorf("listing commitment not found at %s", pda)
	}
	d, err := ParseListingCommitmentAccount(info.Value.Data.GetBinary())
	if err != nil {
		return nil, err
	}
	d.AccountPubkey = pda
	return d, nil
}
