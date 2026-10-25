package models_test

import (
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"testing"
)

// Allowed source files that may set JournalKind: "skip". Each must post an explicit
// balanced journal (PostUsageJournal / PostBalancedJournal) in the same DB tx.
var journalSkipAllowlist = map[string]string{
	"internal/billing/worker.go":           "PostUsageJournal after buyer debit + provider credit",
	"internal/settlement/intent.go":        "PostUsageJournal after intent settle legs",
	"internal/api/compensation_outbox.go":  "PostBalancedJournal reverse on outbox P2P compensate",
}

var journalSkipLiteral = regexp.MustCompile(`JournalKind:\s*"skip"`)

func TestJournalSkipSitesAllowlisted(t *testing.T) {
	t.Parallel()
	root := controlAPIRoot(t)
	var offenders []string
	err := filepath.Walk(filepath.Join(root, "internal"), func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if !journalSkipLiteral.Match(raw) {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			rel = path
		}
		rel = filepath.ToSlash(rel)
		if _, ok := journalSkipAllowlist[rel]; !ok {
			offenders = append(offenders, rel)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk: %v", err)
	}
	if len(offenders) > 0 {
		t.Fatalf("JournalKind:\"skip\" outside allowlist (add pairing Post* + allowlist entry): %v", offenders)
	}
	// Ensure allowlist entries still exist and still contain skip.
	for rel := range journalSkipAllowlist {
		p := filepath.Join(root, filepath.FromSlash(rel))
		raw, err := os.ReadFile(p)
		if err != nil {
			t.Fatalf("allowlisted file missing %s: %v", rel, err)
		}
		if !journalSkipLiteral.Match(raw) {
			t.Fatalf("allowlisted file %s no longer contains JournalKind:\"skip\" — update allowlist", rel)
		}
	}
}

func controlAPIRoot(t *testing.T) string {
	t.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	// .../services/control-api/internal/models/journal_skip_sites_test.go → control-api
	return filepath.Clean(filepath.Join(filepath.Dir(thisFile), "..", ".."))
}
