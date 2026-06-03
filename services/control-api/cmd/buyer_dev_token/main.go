// buyer_dev_token mints a buyer JWT for local governance / map-buy Playwright E2E.
// Uses JWT_SECRET from .env (same as control-api). Sets profiles.wallet_address.
//
// Usage (from services/control-api):
//
//	go run ./cmd/buyer_dev_token -wallet <base58-pubkey>
//	go run ./cmd/buyer_dev_token -wallet-from-playwright-secret
//	go run ./cmd/buyer_dev_token -user <uuid> -wallet <base58> -json
package main

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/joho/godotenv"
	"github.com/mr-tron/base58"
	"github.com/proxyhubb/control-api/internal/crypto"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
)

type output struct {
	Token         string `json:"token"`
	UserID        string `json:"user_id"`
	Email         string `json:"email"`
	WalletAddress string `json:"wallet_address"`
}

func main() {
	envFile := flag.String("env-file", "", "path to .env (default: search repo root)")
	userID := flag.String("user", "", "profile/user UUID (default: latest buyer)")
	wallet := flag.String("wallet", "", "Solana wallet base58 to link on profile")
	fromPlaywright := flag.Bool("wallet-from-playwright-secret", false, "derive wallet from NEXT_PUBLIC_PLAYWRIGHT_SOLANA_WALLET_SECRET")
	ensureBuyer := flag.Bool("ensure-buyer", false, "create dev buyer profile if none exists")
	jsonOut := flag.Bool("json", false, "print JSON on stdout")
	flag.Parse()

	loadEnv(*envFile)

	secret := strings.TrimSpace(os.Getenv("JWT_SECRET"))
	if len(secret) < 64 {
		fatal("JWT_SECRET must be set (64+ chars) — load repo .env used by docker control-api")
	}

	dsn := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if dsn == "" {
		fatal("DATABASE_URL is not set (e.g. localhost:5433 for docker-compose)")
	}
	db.Init(dsn)

	walletAddr := strings.TrimSpace(*wallet)
	if *fromPlaywright {
		if walletAddr != "" {
			fatal("use only one of -wallet or -wallet-from-playwright-secret")
		}
		var err error
		walletAddr, err = walletFromPlaywrightSecret(os.Getenv("NEXT_PUBLIC_PLAYWRIGHT_SOLANA_WALLET_SECRET"))
		if err != nil {
			fatal("%v", err)
		}
	}
	if walletAddr == "" {
		fatal("set -wallet <base58> or -wallet-from-playwright-secret (and export NEXT_PUBLIC_PLAYWRIGHT_SOLANA_WALLET_SECRET)")
	}

	uid, err := resolveBuyerID(*userID, *ensureBuyer)
	if err != nil {
		fatal("%v", err)
	}

	var user models.User
	if err := db.DB.First(&user, "id = ?", uid).Error; err != nil {
		fatal("load profile: %v", err)
	}

	if err := db.DB.Model(&user).Update("wallet_address", walletAddr).Error; err != nil {
		fatal("set wallet_address: %v", err)
	}

	token, err := crypto.GenerateToken(uid, "buyer", user.Email, walletAddr, secret, 24*time.Hour)
	if err != nil {
		fatal("mint jwt: %v", err)
	}

	out := output{
		Token:         token,
		UserID:        uid.String(),
		Email:         user.Email,
		WalletAddress: walletAddr,
	}

	if *jsonOut {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(out)
		return
	}

	fmt.Println("TEST_BUYER_JWT (valid 24h):")
	fmt.Println(token)
	fmt.Println()
	fmt.Printf("User:   %s (%s)\n", out.UserID, out.Email)
	fmt.Printf("Wallet: %s\n", out.WalletAddress)
	fmt.Println()
	fmt.Println("PowerShell:")
	fmt.Printf("  $env:TEST_BUYER_JWT = '%s'\n", token)
}

func walletFromPlaywrightSecret(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", fmt.Errorf("NEXT_PUBLIC_PLAYWRIGHT_SOLANA_WALLET_SECRET is empty")
	}
	var secret []byte
	if strings.HasPrefix(raw, "[") {
		if err := json.Unmarshal([]byte(raw), &secret); err != nil {
			return "", fmt.Errorf("parse playwright secret JSON: %w", err)
		}
	} else {
		dec, err := base64.StdEncoding.DecodeString(raw)
		if err != nil {
			return "", fmt.Errorf("parse playwright secret base64: %w", err)
		}
		secret = dec
	}
	switch len(secret) {
	case ed25519.PrivateKeySize:
		return base58.Encode(secret[32:]), nil
	case ed25519.SeedSize:
		priv := ed25519.NewKeyFromSeed(secret)
		return base58.Encode(priv.Public().(ed25519.PublicKey)), nil
	default:
		return "", fmt.Errorf("playwright secret length %d: expected 32-byte seed or 64-byte keypair", len(secret))
	}
}

func resolveBuyerID(flag string, ensure bool) (uuid.UUID, error) {
	if flag != "" {
		return uuid.Parse(flag)
	}
	var id string
	err := db.DB.Raw(
		`SELECT id::text FROM profiles WHERE role = 'buyer' ORDER BY created_at DESC LIMIT 1`,
	).Scan(&id).Error
	if err != nil || id == "" {
		if !ensure {
			return uuid.Nil, fmt.Errorf("no buyer profile — pass -user <uuid>, use -ensure-buyer, or sign up at /login")
		}
		uid, err := ensureDevBuyerProfile()
		if err != nil {
			return uuid.Nil, err
		}
		fmt.Fprintf(os.Stderr, "buyer_dev_token: created dev buyer profile %s\n", uid)
		return uid, nil
	}
	return uuid.Parse(id)
}

func ensureDevBuyerProfile() (uuid.UUID, error) {
	var profileID uuid.UUID
	email := "dev-buyer-e2e@local.proxyhubb"
	username := "dev-buyer-e2e"

	err := db.DB.Transaction(func(tx *gorm.DB) error {
		var authID uuid.UUID
		authUserSQL := `INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at)
			VALUES ($1, $2, '{}', NOW(), NOW())
			ON CONFLICT (email) DO UPDATE SET updated_at = NOW()
			RETURNING id`
		row := tx.Raw(authUserSQL, uuid.New(), email).Row()
		if row == nil {
			return fmt.Errorf("auth.users insert returned nil row")
		}
		if err := row.Scan(&authID); err != nil {
			return fmt.Errorf("auth.users: %w", err)
		}

		profileSQL := `INSERT INTO profiles (id, email, role, status, trust_tier, username, created_at, updated_at)
			VALUES ($1, $2, 'buyer', 'active', 'new', $3, NOW(), NOW())
			ON CONFLICT (id) DO UPDATE SET role = 'buyer', updated_at = NOW()`
		if err := tx.Exec(profileSQL, authID, email, username).Error; err != nil {
			return fmt.Errorf("profiles: %w", err)
		}

		wallet := models.Wallet{UserID: authID, BalanceSOL: 0}
		wallet.InitializeWithDefaultLimits(models.TrustTierNew)
		if err := tx.Create(&wallet).Error; err != nil {
			return fmt.Errorf("wallet: %w", err)
		}

		profileID = authID
		return nil
	})
	return profileID, err
}

func loadEnv(explicit string) {
	if explicit != "" {
		_ = godotenv.Load(explicit)
		return
	}
	cwd, _ := os.Getwd()
	for dir := cwd; ; dir = filepath.Dir(dir) {
		_ = godotenv.Load(filepath.Join(dir, ".env"))
		if filepath.Base(dir) == "control-api" {
			_ = godotenv.Load(filepath.Join(dir, ".env"))
		}
		if dir == filepath.Dir(dir) {
			break
		}
	}
}

func fatal(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "buyer_dev_token: "+format+"\n", args...)
	os.Exit(1)
}
