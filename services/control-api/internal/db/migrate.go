package db

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// RunMigrations applies every *.up.sql file in migrationsDir that has not yet
// been recorded in the schema_migrations table.  Files are processed in
// lexicographic order, which matches the 000NNN_ numeric prefix convention.
//
// Each migration runs inside a single DB transaction together with the
// schema_migrations insert. Recording failures abort the transaction (hard-fail)
// so DDL cannot apply without a durable version row (P0 MIG-01).
//
// Replaces the 157-model AutoMigrate() call (P3-14).  GORM AutoMigrate is
// intentionally removed to prevent implicit DDL changes in production.
func RunMigrations(migrationsDir string) error {
	if migrationsDir == "" {
		migrationsDir = migrationsDefaultDir()
	}

	// 1. Ensure tracking table exists.
	const createTable = `
CREATE TABLE IF NOT EXISTS schema_migrations (
    version    VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`
	if err := DB.Exec(createTable).Error; err != nil {
		return fmt.Errorf("migrations: failed to create schema_migrations table: %w", err)
	}

	// 2. Load already-applied versions.
	rows, err := DB.Raw("SELECT version FROM schema_migrations ORDER BY version").Rows()
	if err != nil {
		return fmt.Errorf("migrations: failed to query applied versions: %w", err)
	}
	applied := make(map[string]bool)
	for rows.Next() {
		var v string
		if scanErr := rows.Scan(&v); scanErr == nil {
			applied[v] = true
		}
	}
	rows.Close()

	// 3. Collect *.up.sql files.
	entries, err := os.ReadDir(migrationsDir)
	if err != nil {
		return fmt.Errorf("migrations: cannot read migrations dir %q: %w", migrationsDir, err)
	}
	var files []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".up.sql") {
			files = append(files, e.Name())
		}
	}
	sort.Strings(files)

	// 4. Apply pending migrations in order (transactional + hard-fail record).
	pending := 0
	for _, fname := range files {
		version := strings.TrimSuffix(fname, ".up.sql")
		if applied[version] {
			continue
		}

		fpath := filepath.Join(migrationsDir, fname)
		sql, readErr := os.ReadFile(fpath)
		if readErr != nil {
			return fmt.Errorf("migrations: cannot read %s: %w", fpath, readErr)
		}

		log.Printf("migrations: applying %s", version)
		tx := DB.Begin()
		if tx.Error != nil {
			return fmt.Errorf("migrations: begin %s: %w", version, tx.Error)
		}

		if execErr := tx.Exec(string(sql)).Error; execErr != nil {
			_ = tx.Rollback()
			return fmt.Errorf("migrations: failed to apply %s: %w", version, execErr)
		}

		if recErr := tx.Exec(
			"INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
			version, time.Now().UTC(),
		).Error; recErr != nil {
			_ = tx.Rollback()
			return fmt.Errorf("migrations: failed to record %s (rolled back): %w", version, recErr)
		}

		if commitErr := tx.Commit().Error; commitErr != nil {
			return fmt.Errorf("migrations: commit %s: %w", version, commitErr)
		}

		applied[version] = true
		pending++
	}

	if pending == 0 {
		log.Println("migrations: schema is up to date")
	} else {
		log.Printf("migrations: applied %d migration(s) successfully", pending)
	}
	return nil
}

// migrationsDefaultDir resolves the migrations directory from the environment
// (MIGRATIONS_DIR) or falls back to well-known paths for local dev vs Docker.
func migrationsDefaultDir() string {
	if d := os.Getenv("MIGRATIONS_DIR"); d != "" {
		return d
	}
	// Docker image: migrations copied to /app/migrations
	if _, err := os.Stat("/app/migrations"); err == nil {
		return "/app/migrations"
	}
	// Local dev: relative to the control-api working directory
	return "../../migrations"
}
