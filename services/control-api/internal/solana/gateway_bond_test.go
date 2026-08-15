package solana

import (
	"encoding/binary"
	"testing"

	sol "github.com/gagliardetto/solana-go"
)

func TestGatewayBondProgramID_rejectsSession(t *testing.T) {
	t.Setenv("PROXYHUB_GATEWAY_BOND_PROGRAM_ID", UnsafeSessionProgramID)
	if _, err := GatewayBondProgramID(); err == nil {
		t.Fatal("session program id must be rejected")
	}
	if SlashExecuteMode() != "rejected_session_program" {
		t.Fatalf("mode=%s", SlashExecuteMode())
	}
	if SlashWouldBroadcast() {
		t.Fatal("must not broadcast via session program")
	}
}

func TestSlashGates_defaultOff(t *testing.T) {
	t.Setenv("PROXYHUB_GATEWAY_SLASH_AUTO", "")
	t.Setenv("PROXYHUB_GATEWAY_SLASH_CONFIRM", "")
	t.Setenv("PROXYHUB_GATEWAY_BOND_PROGRAM_ID", "")
	if SlashGatesArmed() || SlashWouldBroadcast() {
		t.Fatal("default must be unarmed no-op")
	}
	if SlashExecuteMode() != "off" {
		t.Fatalf("mode=%s", SlashExecuteMode())
	}
	id, err := GatewayBondProgramID()
	if err != nil || id != GatewayBondProgramIDLocalnet {
		t.Fatalf("localnet id: %s %v", id, err)
	}
}

func TestSlashGates_bothRequired(t *testing.T) {
	t.Setenv("PROXYHUB_GATEWAY_BOND_PROGRAM_ID", "")
	t.Setenv("PROXYHUB_GATEWAY_SLASH_AUTO", "true")
	t.Setenv("PROXYHUB_GATEWAY_SLASH_CONFIRM", "")
	if SlashGatesArmed() {
		t.Fatal("AUTO without CONFIRM=1 must not arm")
	}
	t.Setenv("PROXYHUB_GATEWAY_SLASH_CONFIRM", "1")
	t.Setenv("PROXYHUB_GATEWAY_SLASH_AUTO", "")
	if SlashGatesArmed() {
		t.Fatal("CONFIRM without AUTO must not arm")
	}
	t.Setenv("PROXYHUB_GATEWAY_SLASH_AUTO", "1")
	t.Setenv("PROXYHUB_GATEWAY_SLASH_CONFIRM", "1")
	if !SlashGatesArmed() {
		t.Fatal("both gates must arm")
	}
	if SlashWouldBroadcast() {
		t.Fatal("armed still must not broadcast (program undeployed)")
	}
	if SlashExecuteMode() != "gates_armed_undeployed" {
		t.Fatalf("mode=%s", SlashExecuteMode())
	}
}

func TestGatewayBondPDAs_deterministic(t *testing.T) {
	prog := sol.MustPublicKeyFromBase58(GatewayBondProgramIDLocalnet)
	op := sol.MustPublicKeyFromBase58("11111111111111111111111111111112")
	c1, _, err := GetGatewayBondConfigPDA(prog)
	if err != nil {
		t.Fatal(err)
	}
	c2, _, err := GetGatewayBondConfigPDA(prog)
	if err != nil || c1 != c2 {
		t.Fatalf("config pda unstable: %s %s %v", c1, c2, err)
	}
	b1, _, err := GetOperatorBondPDA(prog, op)
	if err != nil {
		t.Fatal(err)
	}
	ch, _, err := GetGatewayChallengePDA(prog, op)
	if err != nil {
		t.Fatal(err)
	}
	if b1 == ch || b1 == c1 || ch == c1 {
		t.Fatal("bond/challenge/config PDAs must differ")
	}
}

func TestFetchGatewayBondConfig_rejectsSession(t *testing.T) {
	_, err := FetchGatewayBondConfig(t.Context(), "", UnsafeSessionProgramID)
	if err == nil {
		t.Fatal("session program id must be rejected")
	}
}

func TestParseGatewayBondConfig_layout(t *testing.T) {
	admin := sol.MustPublicKeyFromBase58(GatewayBondProgramIDLocalnet)
	accuser := sol.MustPublicKeyFromBase58("11111111111111111111111111111112")
	treasury := sol.MustPublicKeyFromBase58("8g7WUuPosAg82Uu7iGYCx6HBnoTBFb4QuyiJCEGzktU4")
	raw := make([]byte, 8+32+32+32+8+8+8+2+1+1)
	p := raw[8:]
	copy(p[0:32], admin.Bytes())
	copy(p[32:64], accuser.Bytes())
	copy(p[64:96], treasury.Bytes())
	binary.LittleEndian.PutUint64(p[96:104], uint64(3600))
	binary.LittleEndian.PutUint64(p[104:112], uint64(7200))
	binary.LittleEndian.PutUint64(p[112:120], 1_000_000)
	binary.LittleEndian.PutUint16(p[120:122], 5_000)
	p[122] = 1
	p[123] = 42
	cfg, err := ParseGatewayBondConfig(raw)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Admin != admin || cfg.Accuser != accuser || cfg.Treasury != treasury {
		t.Fatalf("pubkeys: %+v", cfg)
	}
	if cfg.ChallengeWindowSecs != 3600 || cfg.UnbondingSecs != 7200 {
		t.Fatalf("windows: %d %d", cfg.ChallengeWindowSecs, cfg.UnbondingSecs)
	}
	if cfg.MinStakeLamports != 1_000_000 || cfg.MaxSlashBps != 5_000 {
		t.Fatalf("stake/bps: %d %d", cfg.MinStakeLamports, cfg.MaxSlashBps)
	}
	if !cfg.DeployAllowed || cfg.Bump != 42 {
		t.Fatalf("flags: allowed=%v bump=%d", cfg.DeployAllowed, cfg.Bump)
	}
}

func TestGatewayBondInstructionLayout(t *testing.T) {
	accuser := sol.MustPublicKeyFromBase58("11111111111111111111111111111112")
	treasury := sol.MustPublicKeyFromBase58("8g7WUuPosAg82Uu7iGYCx6HBnoTBFb4QuyiJCEGzktU4")
	init := encodeGatewayBondInitializeConfig(accuser, treasury, 3600, 3600, 1_000_000, 5_000)
	if len(init) != 98 {
		t.Fatalf("init len=%d", len(init))
	}
	if string(init[:8]) != string(discGatewayBondInitializeConfig[:]) {
		t.Fatal("initialize_config discriminator")
	}
	allow := encodeGatewayBondSetDeployAllowed(true)
	if len(allow) != 9 || allow[8] != 1 {
		t.Fatalf("set_deploy_allowed: %x", allow)
	}
	if string(allow[:8]) != string(discGatewayBondSetDeployAllowed[:]) {
		t.Fatal("set_deploy_allowed discriminator")
	}
	bond := encodeGatewayBondBond(1_000_000)
	if len(bond) != 16 {
		t.Fatalf("bond len=%d", len(bond))
	}
	if binary.LittleEndian.Uint64(bond[8:16]) != 1_000_000 {
		t.Fatal("bond amount")
	}
	if string(bond[:8]) != string(discGatewayBondBond[:]) {
		t.Fatal("bond discriminator")
	}
	var ev [32]byte
	ev[0] = 7
	acc := encodeGatewayBondAccuse(ev, 1)
	if len(acc) != 42 {
		t.Fatalf("accuse len=%d", len(acc))
	}
	if string(acc[:8]) != string(discGatewayBondAccuse[:]) {
		t.Fatal("accuse discriminator")
	}
	if acc[8] != 7 || binary.LittleEndian.Uint16(acc[40:42]) != 1 {
		t.Fatalf("accuse payload: %x", acc)
	}
	rel := encodeGatewayBondResolveRelease()
	if len(rel) != 8 || string(rel) != string(discGatewayBondResolveRelease[:]) {
		t.Fatal("resolve_release discriminator")
	}
}

func TestSlashLamports_matchesRust(t *testing.T) {
	got, ok := SlashLamports(1_000_000_000, 5_000)
	if !ok || got != 500_000_000 {
		t.Fatalf("got %d ok=%v", got, ok)
	}
	if _, ok := SlashLamports(100, 0); ok {
		t.Fatal("bps 0")
	}
	if _, ok := SlashLamports(100, 10_001); ok {
		t.Fatal("bps over")
	}
	got, ok = SlashLamports(^uint64(0), 5_000)
	if !ok || got != ^uint64(0)/2 {
		t.Fatalf("overflow-safe half: %d ok=%v", got, ok)
	}
}

func TestParseGatewayBondChallenge_layout(t *testing.T) {
	op := sol.MustPublicKeyFromBase58("11111111111111111111111111111112")
	accuser := sol.MustPublicKeyFromBase58(GatewayBondProgramIDLocalnet)
	raw := make([]byte, 8+32+32+32+2+8+8+1+1)
	p := raw[8:]
	copy(p[0:32], op.Bytes())
	copy(p[32:64], accuser.Bytes())
	p[64] = 9
	binary.LittleEndian.PutUint16(p[96:98], 1)
	binary.LittleEndian.PutUint64(p[98:106], 1_700_000_000)
	binary.LittleEndian.PutUint64(p[106:114], 1_700_003_600)
	p[114] = 0
	p[115] = 3
	ch, err := ParseGatewayBondChallenge(raw)
	if err != nil {
		t.Fatal(err)
	}
	if ch.Operator != op || ch.Accuser != accuser {
		t.Fatalf("pubkeys: %+v", ch)
	}
	if ch.EvidenceHash[0] != 9 || ch.SlashBps != 1 {
		t.Fatalf("evidence/bps: %v %d", ch.EvidenceHash[0], ch.SlashBps)
	}
	if ch.OpenedAt != 1_700_000_000 || ch.ResolveAfter != 1_700_003_600 {
		t.Fatalf("times: %d %d", ch.OpenedAt, ch.ResolveAfter)
	}
	if ch.Status != 0 || ch.Bump != 3 {
		t.Fatalf("status/bump: %d %d", ch.Status, ch.Bump)
	}
}

func TestChallengeWindowRemaining_andAutoRelease(t *testing.T) {
	if ChallengeWindowRemaining(100, 101) != 1 {
		t.Fatal("remaining")
	}
	if ChallengeWindowRemaining(101, 101) != 0 {
		t.Fatal("elapsed")
	}
	at, ok := AutoReleaseAt(1_000, 3_600)
	if !ok || at != 8_200 {
		t.Fatalf("auto_release %d ok=%v", at, ok)
	}
	if _, ok := AutoReleaseAt(1_000, 3_599); ok {
		t.Fatal("window too short")
	}
}

func TestAccuseAndRelease_refuseArmedSlashGates(t *testing.T) {
	t.Setenv("PROXYHUB_GATEWAY_SLASH_AUTO", "1")
	t.Setenv("PROXYHUB_GATEWAY_SLASH_CONFIRM", "1")
	var c *OracleClient
	op := sol.MustPublicKeyFromBase58("11111111111111111111111111111112")
	if _, err := c.AccuseGateway(t.Context(), op, [32]byte{1}, 1); err == nil {
		t.Fatal("accuse must refuse armed slash gates")
	}
	if _, err := c.ResolveGatewayRelease(t.Context(), op, op); err == nil {
		t.Fatal("release must refuse armed slash gates")
	}
}

func TestAccuseGateway_refusesEmptyEvidence(t *testing.T) {
	t.Setenv("PROXYHUB_GATEWAY_SLASH_AUTO", "")
	t.Setenv("PROXYHUB_GATEWAY_SLASH_CONFIRM", "")
	var c *OracleClient
	op := sol.MustPublicKeyFromBase58("11111111111111111111111111111112")
	if _, err := c.AccuseGateway(t.Context(), op, [32]byte{}, 1); err == nil {
		t.Fatal("empty evidence")
	}
	if _, err := c.AccuseGateway(t.Context(), op, [32]byte{1}, 0); err == nil {
		t.Fatal("zero bps")
	}
}
