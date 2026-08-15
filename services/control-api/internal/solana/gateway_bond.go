// Wave 8 bonded-gateway program client (undeployed).
//
// Dedicated program at programs/gateway-bond. Not programs/session
// (8TP21… slash_gateway is unconstrained and must stay undeployed).
package solana

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"math/bits"
	"os"
	"strings"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"
)

// UnsafeSessionProgramID is the undeployed session crate. Never use it as the
// Wave 8 bond program.
const UnsafeSessionProgramID = "8TP21JyrghboxZqXMozx2sVzrDrNSZyN2hkf1D7dQGmb"

// GatewayBondProgramIDLocalnet is programs/gateway-bond (Wave 8.D localnet soak).
// Not programs/session. Not deployed on GCP / mainnet.
const GatewayBondProgramIDLocalnet = "7nvrNVaNWcG4DzcPygEyXoVC3k19ePUAncGE25dUEyi5"

// GatewayBondProgramIDPlaceholder is the default program id when env is unset.
const GatewayBondProgramIDPlaceholder = GatewayBondProgramIDLocalnet

const (
	gatewayBondSeedConfig    = "gateway-bond-config"
	gatewayBondSeedBond      = "gateway-bond"
	gatewayBondSeedChallenge = "gateway-challenge"

	// GatewayBondMinChallengeWindowSecs matches programs/gateway-bond MIN_CHALLENGE_WINDOW_SECS.
	GatewayBondMinChallengeWindowSecs int64 = 3600
)

var (
	discGatewayBondInitializeConfig = anchorDiscriminator("initialize_config")
	discGatewayBondSetDeployAllowed = anchorDiscriminator("set_deploy_allowed")
	discGatewayBondBond             = anchorDiscriminator("bond")
	discGatewayBondAccuse           = anchorDiscriminator("accuse")
	discGatewayBondResolveRelease   = anchorDiscriminator("resolve_release")
)

// ErrGatewayBondAccountMissing is returned when the config or operator-bond PDA is empty.
var ErrGatewayBondAccountMissing = errors.New("gateway-bond account not found")

func IsGatewayBondAccountMissing(err error) bool {
	return errors.Is(err, ErrGatewayBondAccountMissing)
}

func isRPCAccountMissing(err error) bool {
	if err == nil {
		return false
	}
	s := strings.ToLower(err.Error())
	return strings.Contains(s, "not found") || strings.Contains(s, "could not find")
}

// GatewayBondProgramID returns the configured program id, or the undeployed
// placeholder. Rejects the session program id.
func GatewayBondProgramID() (string, error) {
	v := strings.TrimSpace(os.Getenv("PROXYHUB_GATEWAY_BOND_PROGRAM_ID"))
	if v == "" {
		v = GatewayBondProgramIDLocalnet
	}
	if v == UnsafeSessionProgramID {
		return "", fmt.Errorf("PROXYHUB_GATEWAY_BOND_PROGRAM_ID must not be programs/session (%s)", UnsafeSessionProgramID)
	}
	return v, nil
}

// GatewayBondProgramKey parses GatewayBondProgramID.
func GatewayBondProgramKey() (sol.PublicKey, error) {
	id, err := GatewayBondProgramID()
	if err != nil {
		return sol.PublicKey{}, err
	}
	return sol.PublicKeyFromBase58(id)
}

func envTruthy(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

// SlashGatesArmed is true only when both dual-gates are set.
// It does **not** mean a transaction will be sent.
func SlashGatesArmed() bool {
	return envTruthy(os.Getenv("PROXYHUB_GATEWAY_SLASH_AUTO")) &&
		os.Getenv("PROXYHUB_GATEWAY_SLASH_CONFIRM") == "1"
}

// SlashWouldBroadcast is always false in Wave 8.A–C: the bonded program is
// undeployed. Dual-gate + confirm without a claimed live soak stays a no-op.
func SlashWouldBroadcast() bool {
	if !SlashGatesArmed() {
		return false
	}
	if _, err := GatewayBondProgramID(); err != nil {
		return false
	}
	return false
}

// SlashExecuteMode is the honesty string for gateway_slash_execute.
func SlashExecuteMode() string {
	if _, err := GatewayBondProgramID(); err != nil {
		return "rejected_session_program"
	}
	if SlashGatesArmed() {
		return "gates_armed_undeployed"
	}
	return "off"
}

// GetGatewayBondConfigPDA derives ["gateway-bond-config"].
func GetGatewayBondConfigPDA(program sol.PublicKey) (sol.PublicKey, uint8, error) {
	return sol.FindProgramAddress([][]byte{[]byte(gatewayBondSeedConfig)}, program)
}

// GetOperatorBondPDA derives ["gateway-bond", operator].
func GetOperatorBondPDA(program, operator sol.PublicKey) (sol.PublicKey, uint8, error) {
	return sol.FindProgramAddress([][]byte{[]byte(gatewayBondSeedBond), operator.Bytes()}, program)
}

// GetGatewayChallengePDA derives ["gateway-challenge", operator].
func GetGatewayChallengePDA(program, operator sol.PublicKey) (sol.PublicKey, uint8, error) {
	return sol.FindProgramAddress([][]byte{[]byte(gatewayBondSeedChallenge), operator.Bytes()}, program)
}

// GatewayBondConfig is the on-chain BondConfig account (after 8-byte discriminator).
type GatewayBondConfig struct {
	AccountPubkey       sol.PublicKey
	Admin               sol.PublicKey
	Accuser             sol.PublicKey
	Treasury            sol.PublicKey
	ChallengeWindowSecs int64
	UnbondingSecs       int64
	MinStakeLamports    uint64
	MaxSlashBps         uint16
	DeployAllowed       bool
	Bump                uint8
}

// GatewayBondAccount is the on-chain OperatorBond account (after 8-byte discriminator).
type GatewayBondAccount struct {
	AccountPubkey   sol.PublicKey
	Operator        sol.PublicKey
	StakeLamports   uint64
	Bonded          bool
	UnbondingAt     int64
	OpenChallenge   bool
	SlashCount      uint8
	SlashedLamports uint64
	Bump            uint8
}

// GatewayBondChallenge is the on-chain Challenge account (after 8-byte discriminator).
type GatewayBondChallenge struct {
	AccountPubkey sol.PublicKey
	Operator      sol.PublicKey
	Accuser       sol.PublicKey
	EvidenceHash  [32]byte
	SlashBps      uint16
	OpenedAt      int64
	ResolveAfter  int64
	Status        uint8
	Bump          uint8
}

func ParseGatewayBondConfig(raw []byte) (*GatewayBondConfig, error) {
	const need = 8 + 32 + 32 + 32 + 8 + 8 + 8 + 2 + 1 + 1
	if len(raw) < need {
		return nil, fmt.Errorf("bond config account too short: %d", len(raw))
	}
	p := raw[8:]
	out := &GatewayBondConfig{}
	copy(out.Admin[:], p[0:32])
	copy(out.Accuser[:], p[32:64])
	copy(out.Treasury[:], p[64:96])
	out.ChallengeWindowSecs = int64(binary.LittleEndian.Uint64(p[96:104]))
	out.UnbondingSecs = int64(binary.LittleEndian.Uint64(p[104:112]))
	out.MinStakeLamports = binary.LittleEndian.Uint64(p[112:120])
	out.MaxSlashBps = binary.LittleEndian.Uint16(p[120:122])
	out.DeployAllowed = p[122] != 0
	out.Bump = p[123]
	return out, nil
}

func ParseGatewayBondAccount(raw []byte) (*GatewayBondAccount, error) {
	const need = 8 + 32 + 8 + 1 + 8 + 1 + 1 + 8 + 1
	if len(raw) < need {
		return nil, fmt.Errorf("operator bond account too short: %d", len(raw))
	}
	p := raw[8:]
	out := &GatewayBondAccount{}
	copy(out.Operator[:], p[0:32])
	out.StakeLamports = binary.LittleEndian.Uint64(p[32:40])
	out.Bonded = p[40] != 0
	out.UnbondingAt = int64(binary.LittleEndian.Uint64(p[41:49]))
	out.OpenChallenge = p[49] != 0
	out.SlashCount = p[50]
	out.SlashedLamports = binary.LittleEndian.Uint64(p[51:59])
	out.Bump = p[59]
	return out, nil
}

// FetchGatewayBondConfig is a read-only RPC lookup (no keypair).
func FetchGatewayBondConfig(ctx context.Context, rpcURL, programIDStr string) (*GatewayBondConfig, error) {
	if strings.TrimSpace(programIDStr) == UnsafeSessionProgramID {
		return nil, fmt.Errorf("PROXYHUB_GATEWAY_BOND_PROGRAM_ID must not be programs/session")
	}
	prog, err := sol.PublicKeyFromBase58(programIDStr)
	if err != nil {
		return nil, fmt.Errorf("program id: %w", err)
	}
	pda, _, err := GetGatewayBondConfigPDA(prog)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(rpcURL) == "" {
		rpcURL = DefaultDevnetRPCEndpoint
	}
	client := rpc.New(rpcURL)
	info, err := client.GetAccountInfoWithOpts(ctx, pda, &rpc.GetAccountInfoOpts{
		Commitment: rpc.CommitmentConfirmed,
	})
	if err != nil {
		if isRPCAccountMissing(err) {
			return nil, fmt.Errorf("%w: %s", ErrGatewayBondAccountMissing, pda)
		}
		return nil, fmt.Errorf("GetAccountInfo: %w", err)
	}
	if info == nil || info.Value == nil {
		return nil, fmt.Errorf("%w: %s", ErrGatewayBondAccountMissing, pda)
	}
	if !info.Value.Owner.Equals(prog) {
		return nil, fmt.Errorf("config owner %s is not gateway-bond", info.Value.Owner)
	}
	cfg, err := ParseGatewayBondConfig(info.Value.Data.GetBinary())
	if err != nil {
		return nil, err
	}
	cfg.AccountPubkey = pda
	return cfg, nil
}

// FetchOperatorBond is a read-only RPC lookup (no keypair).
func FetchOperatorBond(ctx context.Context, rpcURL, programIDStr string, operator sol.PublicKey) (*GatewayBondAccount, error) {
	if strings.TrimSpace(programIDStr) == UnsafeSessionProgramID {
		return nil, fmt.Errorf("PROXYHUB_GATEWAY_BOND_PROGRAM_ID must not be programs/session")
	}
	prog, err := sol.PublicKeyFromBase58(programIDStr)
	if err != nil {
		return nil, fmt.Errorf("program id: %w", err)
	}
	pda, _, err := GetOperatorBondPDA(prog, operator)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(rpcURL) == "" {
		rpcURL = DefaultDevnetRPCEndpoint
	}
	client := rpc.New(rpcURL)
	info, err := client.GetAccountInfoWithOpts(ctx, pda, &rpc.GetAccountInfoOpts{
		Commitment: rpc.CommitmentConfirmed,
	})
	if err != nil {
		if isRPCAccountMissing(err) {
			return nil, fmt.Errorf("%w: %s", ErrGatewayBondAccountMissing, pda)
		}
		return nil, fmt.Errorf("GetAccountInfo: %w", err)
	}
	if info == nil || info.Value == nil {
		return nil, fmt.Errorf("%w: %s", ErrGatewayBondAccountMissing, pda)
	}
	row, err := ParseGatewayBondAccount(info.Value.Data.GetBinary())
	if err != nil {
		return nil, err
	}
	row.AccountPubkey = pda
	return row, nil
}

func ParseGatewayBondChallenge(raw []byte) (*GatewayBondChallenge, error) {
	const need = 8 + 32 + 32 + 32 + 2 + 8 + 8 + 1 + 1
	if len(raw) < need {
		return nil, fmt.Errorf("challenge account too short: %d", len(raw))
	}
	p := raw[8:]
	out := &GatewayBondChallenge{}
	copy(out.Operator[:], p[0:32])
	copy(out.Accuser[:], p[32:64])
	copy(out.EvidenceHash[:], p[64:96])
	out.SlashBps = binary.LittleEndian.Uint16(p[96:98])
	out.OpenedAt = int64(binary.LittleEndian.Uint64(p[98:106]))
	out.ResolveAfter = int64(binary.LittleEndian.Uint64(p[106:114]))
	out.Status = p[114]
	out.Bump = p[115]
	return out, nil
}

// FetchGatewayChallenge is a read-only RPC lookup (no keypair).
func FetchGatewayChallenge(ctx context.Context, rpcURL, programIDStr string, operator sol.PublicKey) (*GatewayBondChallenge, error) {
	if strings.TrimSpace(programIDStr) == UnsafeSessionProgramID {
		return nil, fmt.Errorf("PROXYHUB_GATEWAY_BOND_PROGRAM_ID must not be programs/session")
	}
	prog, err := sol.PublicKeyFromBase58(programIDStr)
	if err != nil {
		return nil, fmt.Errorf("program id: %w", err)
	}
	pda, _, err := GetGatewayChallengePDA(prog, operator)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(rpcURL) == "" {
		rpcURL = DefaultDevnetRPCEndpoint
	}
	client := rpc.New(rpcURL)
	info, err := client.GetAccountInfoWithOpts(ctx, pda, &rpc.GetAccountInfoOpts{
		Commitment: rpc.CommitmentConfirmed,
	})
	if err != nil {
		if isRPCAccountMissing(err) {
			return nil, fmt.Errorf("%w: %s", ErrGatewayBondAccountMissing, pda)
		}
		return nil, fmt.Errorf("GetAccountInfo: %w", err)
	}
	if info == nil || info.Value == nil {
		return nil, fmt.Errorf("%w: %s", ErrGatewayBondAccountMissing, pda)
	}
	row, err := ParseGatewayBondChallenge(info.Value.Data.GetBinary())
	if err != nil {
		return nil, err
	}
	row.AccountPubkey = pda
	return row, nil
}

func (c *OracleClient) gatewayBondProgram() (sol.PublicKey, error) {
	return GatewayBondProgramKey()
}

// InitializeGatewayBondConfig sends initialize_config (deploy_allowed starts false).
func (c *OracleClient) InitializeGatewayBondConfig(ctx context.Context, accuser, treasury sol.PublicKey, challengeWindow, unbonding int64, minStake uint64, maxSlashBps uint16) (string, error) {
	prog, err := c.gatewayBondProgram()
	if err != nil {
		return "", err
	}
	if prog.String() == UnsafeSessionProgramID {
		return "", fmt.Errorf("refused: programs/session")
	}
	if challengeWindow < GatewayBondMinChallengeWindowSecs || unbonding < GatewayBondMinChallengeWindowSecs {
		return "", fmt.Errorf("window must be >= %d", GatewayBondMinChallengeWindowSecs)
	}
	cfgPDA, _, err := GetGatewayBondConfigPDA(prog)
	if err != nil {
		return "", err
	}
	admin := c.GetOraclePublicKey()
	data := encodeGatewayBondInitializeConfig(accuser, treasury, challengeWindow, unbonding, minStake, maxSlashBps)
	ix := &GenericInstruction{
		programID: prog,
		accounts: []*sol.AccountMeta{
			{PublicKey: cfgPDA, IsSigner: false, IsWritable: true},
			{PublicKey: admin, IsSigner: true, IsWritable: true},
			{PublicKey: sol.SystemProgramID, IsSigner: false, IsWritable: false},
		},
		data: data,
	}
	return c.sendInstruction(ctx, ix)
}

// SetGatewayBondDeployAllowed sends set_deploy_allowed. Soak only; not slash execute.
func (c *OracleClient) SetGatewayBondDeployAllowed(ctx context.Context, allowed bool) (string, error) {
	prog, err := c.gatewayBondProgram()
	if err != nil {
		return "", err
	}
	cfgPDA, _, err := GetGatewayBondConfigPDA(prog)
	if err != nil {
		return "", err
	}
	admin := c.GetOraclePublicKey()
	data := encodeGatewayBondSetDeployAllowed(allowed)
	ix := &GenericInstruction{
		programID: prog,
		accounts: []*sol.AccountMeta{
			{PublicKey: cfgPDA, IsSigner: false, IsWritable: true},
			{PublicKey: admin, IsSigner: true, IsWritable: false},
		},
		data: data,
	}
	return c.sendInstruction(ctx, ix)
}

// BondGatewayStake sends bond. Operator signer is the oracle (soak).
func (c *OracleClient) BondGatewayStake(ctx context.Context, amount uint64) (string, error) {
	if amount == 0 {
		return "", fmt.Errorf("bond amount must be > 0")
	}
	prog, err := c.gatewayBondProgram()
	if err != nil {
		return "", err
	}
	operator := c.GetOraclePublicKey()
	cfgPDA, _, err := GetGatewayBondConfigPDA(prog)
	if err != nil {
		return "", err
	}
	bondPDA, _, err := GetOperatorBondPDA(prog, operator)
	if err != nil {
		return "", err
	}
	data := encodeGatewayBondBond(amount)
	ix := &GenericInstruction{
		programID: prog,
		accounts: []*sol.AccountMeta{
			{PublicKey: bondPDA, IsSigner: false, IsWritable: true},
			{PublicKey: cfgPDA, IsSigner: false, IsWritable: false},
			{PublicKey: operator, IsSigner: true, IsWritable: true},
			{PublicKey: sol.SystemProgramID, IsSigner: false, IsWritable: false},
		},
		data: data,
	}
	return c.sendInstruction(ctx, ix)
}

// AccuseGateway opens a challenge. Does not move stake. Slash dual-gates must stay unset.
func (c *OracleClient) AccuseGateway(ctx context.Context, operator sol.PublicKey, evidenceHash [32]byte, slashBps uint16) (string, error) {
	if SlashGatesArmed() {
		return "", fmt.Errorf("refused: PROXYHUB_GATEWAY_SLASH_* must stay unset for accuse/release")
	}
	if evidenceHash == ([32]byte{}) {
		return "", fmt.Errorf("evidence_hash must be non-zero")
	}
	if slashBps == 0 {
		return "", fmt.Errorf("slash_bps must be > 0 (release soak still records a cap; resolve_slash is not sent)")
	}
	prog, err := c.gatewayBondProgram()
	if err != nil {
		return "", err
	}
	if prog.String() == UnsafeSessionProgramID {
		return "", fmt.Errorf("refused: programs/session")
	}
	accuser := c.GetOraclePublicKey()
	cfgPDA, _, err := GetGatewayBondConfigPDA(prog)
	if err != nil {
		return "", err
	}
	bondPDA, _, err := GetOperatorBondPDA(prog, operator)
	if err != nil {
		return "", err
	}
	chPDA, _, err := GetGatewayChallengePDA(prog, operator)
	if err != nil {
		return "", err
	}
	ix := &GenericInstruction{
		programID: prog,
		accounts: []*sol.AccountMeta{
			{PublicKey: operator, IsSigner: false, IsWritable: false},
			{PublicKey: bondPDA, IsSigner: false, IsWritable: true},
			{PublicKey: chPDA, IsSigner: false, IsWritable: true},
			{PublicKey: cfgPDA, IsSigner: false, IsWritable: false},
			{PublicKey: accuser, IsSigner: true, IsWritable: true},
			{PublicKey: sol.SystemProgramID, IsSigner: false, IsWritable: false},
		},
		data: encodeGatewayBondAccuse(evidenceHash, slashBps),
	}
	return c.sendInstruction(ctx, ix)
}

// ResolveGatewayRelease closes an open challenge without moving stake.
// Admin may sign immediately on-chain; W11.C soak still waits 3600s off-chain first.
func (c *OracleClient) ResolveGatewayRelease(ctx context.Context, operator, accuserRent sol.PublicKey) (string, error) {
	if SlashGatesArmed() {
		return "", fmt.Errorf("refused: PROXYHUB_GATEWAY_SLASH_* must stay unset for accuse/release")
	}
	if accuserRent.IsZero() {
		return "", fmt.Errorf("accuser_rent required")
	}
	prog, err := c.gatewayBondProgram()
	if err != nil {
		return "", err
	}
	if prog.String() == UnsafeSessionProgramID {
		return "", fmt.Errorf("refused: programs/session")
	}
	signer := c.GetOraclePublicKey()
	cfgPDA, _, err := GetGatewayBondConfigPDA(prog)
	if err != nil {
		return "", err
	}
	bondPDA, _, err := GetOperatorBondPDA(prog, operator)
	if err != nil {
		return "", err
	}
	chPDA, _, err := GetGatewayChallengePDA(prog, operator)
	if err != nil {
		return "", err
	}
	ix := &GenericInstruction{
		programID: prog,
		accounts: []*sol.AccountMeta{
			{PublicKey: operator, IsSigner: false, IsWritable: false},
			{PublicKey: bondPDA, IsSigner: false, IsWritable: true},
			{PublicKey: chPDA, IsSigner: false, IsWritable: true},
			{PublicKey: cfgPDA, IsSigner: false, IsWritable: false},
			{PublicKey: signer, IsSigner: true, IsWritable: false},
			{PublicKey: accuserRent, IsSigner: false, IsWritable: true},
		},
		data: encodeGatewayBondResolveRelease(),
	}
	return c.sendInstruction(ctx, ix)
}

func encodeGatewayBondInitializeConfig(accuser, treasury sol.PublicKey, challengeWindow, unbonding int64, minStake uint64, maxSlashBps uint16) []byte {
	data := make([]byte, 8+32+32+8+8+8+2)
	copy(data[0:8], discGatewayBondInitializeConfig[:])
	copy(data[8:40], accuser.Bytes())
	copy(data[40:72], treasury.Bytes())
	binary.LittleEndian.PutUint64(data[72:80], uint64(challengeWindow))
	binary.LittleEndian.PutUint64(data[80:88], uint64(unbonding))
	binary.LittleEndian.PutUint64(data[88:96], minStake)
	binary.LittleEndian.PutUint16(data[96:98], maxSlashBps)
	return data
}

func encodeGatewayBondSetDeployAllowed(allowed bool) []byte {
	data := make([]byte, 9)
	copy(data[0:8], discGatewayBondSetDeployAllowed[:])
	if allowed {
		data[8] = 1
	}
	return data
}

func encodeGatewayBondBond(amount uint64) []byte {
	data := make([]byte, 16)
	copy(data[0:8], discGatewayBondBond[:])
	binary.LittleEndian.PutUint64(data[8:16], amount)
	return data
}

func encodeGatewayBondAccuse(evidenceHash [32]byte, slashBps uint16) []byte {
	data := make([]byte, 8+32+2)
	copy(data[0:8], discGatewayBondAccuse[:])
	copy(data[8:40], evidenceHash[:])
	binary.LittleEndian.PutUint16(data[40:42], slashBps)
	return data
}

func encodeGatewayBondResolveRelease() []byte {
	data := make([]byte, 8)
	copy(data[0:8], discGatewayBondResolveRelease[:])
	return data
}

// ChallengeWindowRemaining is seconds until resolve_after (0 if elapsed).
func ChallengeWindowRemaining(now, resolveAfter int64) int64 {
	if now >= resolveAfter {
		return 0
	}
	return resolveAfter - now
}

// AutoReleaseAt is opened_at + 2*window (operator may force-release then).
func AutoReleaseAt(openedAt, challengeWindowSecs int64) (int64, bool) {
	if challengeWindowSecs < GatewayBondMinChallengeWindowSecs {
		return 0, false
	}
	return openedAt + challengeWindowSecs*2, true
}

// SlashLamports is stake * bps / 10_000 (matching programs/gateway-bond math.rs).
func SlashLamports(stake uint64, bps uint16) (uint64, bool) {
	if bps == 0 || bps > 10_000 {
		return 0, false
	}
	hi, lo := bits.Mul64(stake, uint64(bps))
	q, _ := bits.Div64(hi, lo, 10_000)
	return q, true
}
