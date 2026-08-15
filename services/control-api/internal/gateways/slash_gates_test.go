package gateways

import "testing"

func TestSlashExecuteMode(t *testing.T) {
	t.Setenv("PROXYHUB_GATEWAY_BOND_PROGRAM_ID", "")
	t.Setenv("PROXYHUB_GATEWAY_SLASH_AUTO", "")
	t.Setenv("PROXYHUB_GATEWAY_SLASH_CONFIRM", "")
	if SlashExecuteMode() != "off" {
		t.Fatalf("%s", SlashExecuteMode())
	}
	t.Setenv("PROXYHUB_GATEWAY_SLASH_AUTO", "true")
	t.Setenv("PROXYHUB_GATEWAY_SLASH_CONFIRM", "1")
	if SlashExecuteMode() != "gates_armed_undeployed" {
		t.Fatalf("%s", SlashExecuteMode())
	}
	t.Setenv("PROXYHUB_GATEWAY_BOND_PROGRAM_ID", UnsafeSessionProgramID)
	if SlashExecuteMode() != "rejected_session_program" {
		t.Fatalf("%s", SlashExecuteMode())
	}
}

func TestHonestyMeta_armedStillNotLiveSlash(t *testing.T) {
	t.Setenv("PROXYHUB_GATEWAY_SLASH_AUTO", "1")
	t.Setenv("PROXYHUB_GATEWAY_SLASH_CONFIRM", "1")
	t.Setenv("PROXYHUB_GATEWAY_BOND_PROGRAM_ID", "")
	m := HonestyMeta(nil)
	if m["live_economic_slash"] != false {
		t.Fatal("armed gates must not claim live slash")
	}
	if m["gateway_slash_execute"] != "gates_armed_undeployed" {
		t.Fatalf("%v", m["gateway_slash_execute"])
	}
}
