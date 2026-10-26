package solana

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func writeTestKeypair(t *testing.T, perm os.FileMode) string {
	t.Helper()
	k, err := GenerateRandomKeypair()
	if err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal([]byte(k))
	path := filepath.Join(t.TempDir(), "kp.json")
	if err := os.WriteFile(path, data, perm); err != nil {
		t.Fatal(err)
	}
	// WriteFile honours umask; force exact mode.
	if err := os.Chmod(path, perm); err != nil {
		t.Fatal(err)
	}
	return path
}

// W-28: group/other-readable keypair files are refused at load time.
func TestLoadKeypair_P2_PermsEnforced(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX perms only")
	}
	t.Setenv("APP_ENV", "development")
	t.Setenv("ORACLE_KEYPAIR_ENCRYPTION_KEY", "")
	bad := writeTestKeypair(t, 0o644)
	if _, err := loadKeypair(bad); err == nil || !strings.Contains(err.Error(), "0600") {
		t.Fatalf("0644 keypair must be refused, got %v", err)
	}
	good := writeTestKeypair(t, 0o600)
	if _, err := loadKeypair(good); err != nil {
		t.Fatalf("0600 keypair should load in dev: %v", err)
	}
}

// W-28: plaintext keypair files are refused in production even at 0600.
func TestLoadKeypair_P2_PlaintextRefusedInProd(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX perms only")
	}
	t.Setenv("APP_ENV", "production")
	t.Setenv("ORACLE_KEYPAIR_ENCRYPTION_KEY", "")
	path := writeTestKeypair(t, 0o600)
	if _, err := loadKeypair(path); err == nil || !strings.Contains(err.Error(), "refused in production") {
		t.Fatalf("plaintext keypair must be refused in prod, got %v", err)
	}
}

// W-28: SendSOLFrom is velocity-gated (was: uncounted platform-key send).
func TestCheckTransferCap_P2(t *testing.T) {
	v := &VelocityGuard{maxSingleSOL: 5, maxHourlySOL: 50}
	if err := v.CheckTransferCap(5); err != nil {
		t.Fatalf("at cap should pass: %v", err)
	}
	if err := v.CheckTransferCap(5.01); err == nil {
		t.Fatal("over cap must fail")
	}
	v.Freeze()
	if err := v.CheckTransferCap(0.1); err == nil {
		t.Fatal("frozen guard must block cap-only checks too")
	}
}
