// custody-rewrap is an offline operator tool, never an API route.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/custody"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "custody rewrap failed:", err)
		os.Exit(1)
	}
}

func run() error {
	from := flag.String("from", "", "exact stored source KEK ID")
	after := flag.String("after", "", "last successful next_cursor")
	limit := flag.Int("limit", 100, "maximum rows, 1..500")
	apply := flag.Bool("apply", false, "commit verified DEK rewraps (default: dry run)")
	legacy := flag.Bool("read-legacy-local", false, "offline migration only: read local:v1 from EMBEDDED_WALLET_LEGACY_KEK")
	flag.Parse()
	if *from == "" {
		return fmt.Errorf("--from is required")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	ctx, cancel := context.WithTimeout(ctx, 30*time.Minute)
	defer cancel()
	k, err := custody.DefaultKEK()
	if err != nil {
		return err
	}
	// Require a remote target even for a development-to-production migration.
	if os.Getenv("EMBEDDED_WALLET_KEK_PROVIDER") != "gcp-kms" {
		return fmt.Errorf("target must be gcp-kms")
	}
	if *legacy {
		if *from != "local:v1" {
			return fmt.Errorf("legacy mode requires --from=local:v1")
		}
		old, err := custody.NewLocalKEK(os.Getenv("EMBEDDED_WALLET_LEGACY_KEK"))
		os.Unsetenv("EMBEDDED_WALLET_LEGACY_KEK")
		if err != nil {
			return err
		}
		k, err = custody.NewKeyRing(k, old)
		if err != nil {
			return err
		}
	}
	cursor := uuid.Nil
	if *after != "" {
		cursor, err = uuid.Parse(*after)
		if err != nil {
			return fmt.Errorf("invalid cursor")
		}
	}
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		return fmt.Errorf("DATABASE_URL is required")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent), DisableAutomaticPing: true})
	if err != nil {
		return fmt.Errorf("database configuration failed")
	}
	sqlDB, err := db.DB()
	if err != nil {
		return fmt.Errorf("database unavailable")
	}
	defer sqlDB.Close()
	sqlDB.SetMaxOpenConns(1)
	if err := sqlDB.PingContext(ctx); err != nil {
		return fmt.Errorf("database unavailable")
	}
	result, err := custody.RewrapBatch(ctx, db, k, *from, cursor, *limit, *apply)
	// Emit progress even on a partial batch failure so completed rows are known.
	if encErr := json.NewEncoder(os.Stdout).Encode(result); encErr != nil {
		return encErr
	}
	if err != nil {
		return fmt.Errorf("batch stopped; source keys must remain enabled")
	}
	return nil
}
