// provider_dev_token mints a provider API token against the local dev database.
// Uses the same TOKEN_HMAC_SECRET and hashing as control-api — tokens work with
// POST /v1/provider/auth and provider-node without using the web dashboard.
//
// Usage (from services/control-api):
//
//	go run ./cmd/provider_dev_token
//	go run ./cmd/provider_dev_token -user 741719aa-9973-43ac-a802-63fbd137fdec -write-toml
//
// Requires DATABASE_URL and TOKEN_HMAC_SECRET (load from repo .env via -env-file).
package main

import (
	"crypto/ed25519"
	"encoding/json"
	"flag"
	"fmt"
	"log"
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
	Token              string `json:"token"`
	UserID             string `json:"user_id"`
	TokenID            string `json:"token_id"`
	TokenName          string `json:"token_name"`
	TomlPath           string `json:"toml_path,omitempty"`
	SigningKey         string `json:"signing_key,omitempty"`
	SigningPublicKey   string `json:"signing_public_key,omitempty"`
	HotkeySyncedNodeID string `json:"hotkey_synced_node_id,omitempty"`
}

func main() {
	envFile := flag.String("env-file", "", "path to .env (default: search repo root)")
	userID := flag.String("user", "", "profile/user UUID (default: latest provider profile)")
	tokenName := flag.String("name", "dev-local-cli", "token label in DB")
	writeToml := flag.String("write-toml", "", "write provider.toml (default path if flag set with no value)")
	skipToml := flag.Bool("no-write-toml", false, "only print token; do not write provider.toml")
	apiURL := flag.String("api-url", "http://localhost:18080", "control_api_url for generated toml")
	gatewayAddr := flag.String("gateway", "localhost:3128", "gateway_addr for generated toml")
	signingKey := flag.String("signing-key", "", "base58 Ed25519 seed/keypair for provider proofs (optional)")
	generateSigningKey := flag.Bool("generate-signing-key", false, "generate a new base58 signing key for provider proofs")
	syncHotkey := flag.Bool("sync-hotkey", false, "set provider_nodes.hotkey to the signing public key for the user's latest node")
	signingOnly := flag.Bool("signing-only", false, "only generate/sync signing key and optional toml; do not mint a new API token")
	ensureProfile := flag.Bool("ensure-profile", false, "create a dev provider profile+node if the DB has none (local Docker bootstrap)")
	jsonOut := flag.Bool("json", false, "print machine-readable JSON on stdout")
	outputJSON := flag.String("output-json", "", "write machine-readable JSON to this file (recommended for scripts)")
	flag.Parse()

	loadEnv(*envFile)

	if *jsonOut || *outputJSON != "" {
		log.SetOutput(os.Stderr)
		_ = os.Setenv("DB_LOG_LEVEL", "silent")
	}

	secret := strings.TrimSpace(os.Getenv("TOKEN_HMAC_SECRET"))
	if err := crypto.ValidateTokenHMACSecret(secret); err != nil {
		fatal("%v", err)
	}
	models.TokenHashFn = crypto.NewTokenHashFn(secret)

	dsn := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if dsn == "" {
		fatal("DATABASE_URL is not set (use host postgres e.g. localhost:5433 for docker-compose.dev)")
	}
	db.Init(dsn)

	uid, err := resolveUserID(*userID, *ensureProfile)
	if err != nil {
		fatal("%v", err)
	}

	out := output{UserID: uid.String()}

	if *signingOnly {
		if *skipToml && !*jsonOut && *outputJSON == "" {
			fatal("signing-only requires -write-toml, -json, and/or -output-json")
		}
	} else {
		raw, err := models.GenerateRawToken()
		if err != nil {
			fatal("generate token: %v", err)
		}

		record := models.ProviderToken{
			ID:       uuid.New(),
			UserID:   uid,
			Token:    models.HashToken(raw),
			Name:     *tokenName,
			IsActive: true,
		}
		if err := db.DB.Create(&record).Error; err != nil {
			fatal("save token: %v", err)
		}

		out.Token = raw
		out.TokenID = record.ID.String()
		out.TokenName = record.Name
	}

	seed, pub, err := resolveSigningMaterial(*signingKey, *generateSigningKey)
	if err != nil {
		fatal("%v", err)
	}
	if seed != "" {
		out.SigningKey = seed
		out.SigningPublicKey = pub
	}
	if *syncHotkey && pub != "" {
		nodeID := lookupProviderNodeID(uid)
		if nodeID == "" {
			fmt.Fprintf(os.Stderr, "provider_dev_token: sync-hotkey skipped (no provider_nodes row for user %s)\n", uid)
		} else if err := db.DB.Exec(
			`UPDATE provider_nodes SET hotkey = ? WHERE id = ?::uuid`,
			pub, nodeID,
		).Error; err != nil {
			fatal("sync-hotkey: %v", err)
		} else {
			out.HotkeySyncedNodeID = nodeID
		}
	}

	if !*skipToml {
		tomlPath := *writeToml
		if tomlPath == "" {
			tomlPath = defaultTomlPath()
		}
		nodeID := lookupProviderNodeID(uid)
		if err := writeProviderToml(tomlPath, *apiURL, *gatewayAddr, out.Token, nodeID, seed); err != nil {
			fatal("write toml: %v", err)
		}
		out.TomlPath = tomlPath
	}

	if *jsonOut || *outputJSON != "" {
		emitJSONOutput(out, *jsonOut, *outputJSON)
		return
	}

	fmt.Println("--------------------------------------------------")
	fmt.Println("Dev provider token (local only - do not commit)")
	fmt.Println("--------------------------------------------------")
	fmt.Printf("Token:    %s\n", out.Token)
	fmt.Printf("User:     %s\n", out.UserID)
	fmt.Printf("Token ID: %s\n", out.TokenID)
	if out.SigningPublicKey != "" {
		fmt.Printf("Sign pub: %s\n", out.SigningPublicKey)
	}
	if out.HotkeySyncedNodeID != "" {
		fmt.Printf("Hotkey synced on node: %s\n", out.HotkeySyncedNodeID)
	}
	if out.TomlPath != "" {
		fmt.Printf("Config:   %s\n", out.TomlPath)
		fmt.Println()
		fmt.Println("Next:")
		fmt.Printf("  .\\scripts\\test-provider-auth.ps1\n")
		fmt.Printf("  provider-node start --config \"%s\"\n", out.TomlPath)
	}
	fmt.Println("--------------------------------------------------")
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

func resolveUserID(flag string, ensure bool) (uuid.UUID, error) {
	if flag != "" {
		return uuid.Parse(flag)
	}
	var id string
	err := db.DB.Raw(
		`SELECT id::text FROM profiles WHERE role = 'provider' ORDER BY created_at DESC LIMIT 1`,
	).Scan(&id).Error
	if err != nil || id == "" {
		err = db.DB.Raw(
			`SELECT id::text FROM profiles ORDER BY created_at DESC LIMIT 1`,
		).Scan(&id).Error
	}
	if err != nil || id == "" {
		if !ensure {
			return uuid.Nil, fmt.Errorf("no profile in DB — sign up once, pass -user <uuid>, or use -ensure-profile")
		}
		uid, err := ensureDevProviderProfile()
		if err != nil {
			return uuid.Nil, err
		}
		fmt.Fprintf(os.Stderr, "provider_dev_token: created dev provider profile %s\n", uid)
		return uid, nil
	}
	return uuid.Parse(id)
}

// ensureDevProviderProfile creates a minimal provider user for local Docker bootstrap (empty DB after compose down -v).
func ensureDevProviderProfile() (uuid.UUID, error) {
	var profileID uuid.UUID
	email := "dev-provider@local.proxyhubb"
	username := "dev-provider"

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
			VALUES ($1, $2, 'provider', 'active', 'new', $3, NOW(), NOW())
			ON CONFLICT (id) DO UPDATE SET role = 'provider', updated_at = NOW()`
		if err := tx.Exec(profileSQL, authID, email, username).Error; err != nil {
			return fmt.Errorf("profiles: %w", err)
		}

		wallet := models.Wallet{UserID: authID, BalanceSOL: 0}
		wallet.InitializeWithDefaultLimits(models.TrustTierNew)
		if err := tx.Create(&wallet).Error; err != nil {
			return fmt.Errorf("wallet: %w", err)
		}

		node := models.ProviderNode{
			ID:            uuid.New(),
			UserID:        authID,
			Name:          "docker-dev",
			Status:        models.NodeOffline,
			GatewayNodeID: "node_" + authID.String(),
		}
		if err := tx.Omit("ip_address").Create(&node).Error; err != nil {
			return fmt.Errorf("provider_nodes: %w", err)
		}
		profileID = authID
		return nil
	})
	if err != nil {
		return uuid.Nil, err
	}
	return profileID, nil
}

func lookupProviderNodeID(userID uuid.UUID) string {
	var id string
	err := db.DB.Raw(
		`SELECT id::text FROM provider_nodes WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
		userID,
	).Scan(&id).Error
	if err != nil || id == "" {
		return ""
	}
	return id
}

func defaultTomlPath() string {
	if xdg := strings.TrimSpace(os.Getenv("XDG_CONFIG_HOME")); xdg != "" {
		return filepath.Join(xdg, "proxyhubb", "provider.toml")
	}
	if appData := strings.TrimSpace(os.Getenv("APPDATA")); appData != "" {
		return filepath.Join(appData, "proxyhubb", "provider.toml")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "provider.toml"
	}
	return filepath.Join(home, ".config", "proxyhubb", "provider.toml")
}

func resolveSigningMaterial(explicit string, generate bool) (seed string, pub string, err error) {
	explicit = strings.TrimSpace(explicit)
	if generate && explicit != "" {
		return "", "", fmt.Errorf("use only one of -signing-key or -generate-signing-key")
	}
	if generate {
		_, priv, genErr := ed25519.GenerateKey(nil)
		if genErr != nil {
			return "", "", genErr
		}
		seed = base58.Encode(priv.Seed())
		pub = base58.Encode(priv.Public().(ed25519.PublicKey))
		return seed, pub, nil
	}
	if explicit == "" {
		return "", "", nil
	}
	bytes, decErr := base58.Decode(explicit)
	if decErr != nil {
		return "", "", fmt.Errorf("signing-key: invalid base58: %w", decErr)
	}
	var priv ed25519.PrivateKey
	switch len(bytes) {
	case ed25519.SeedSize:
		priv = ed25519.NewKeyFromSeed(bytes)
	case ed25519.PrivateKeySize:
		priv = ed25519.PrivateKey(bytes)
	default:
		return "", "", fmt.Errorf("signing-key: want %d or %d bytes, got %d", ed25519.SeedSize, ed25519.PrivateKeySize, len(bytes))
	}
	return base58.Encode(priv.Seed()), base58.Encode(priv.Public().(ed25519.PublicKey)), nil
}

func writeProviderToml(path, apiURL, gateway, apiKey, nodeID, signingKey string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	nodeLine := ""
	if nodeID != "" {
		nodeLine = fmt.Sprintf("node_id = %q\n", nodeID)
	}
	signingLine := ""
	if strings.TrimSpace(signingKey) != "" {
		signingLine = fmt.Sprintf("provider_signing_key = %q\n", strings.TrimSpace(signingKey))
	}
	body := fmt.Sprintf(`# Generated by provider_dev_token at %s — dev/local only
control_api_url = %q
gateway_addr = %q
api_key = %q
%s%sconnection_type = "residential"
use_tls = true
tls_skip_verify = true
metrics_port = 9090
`, time.Now().UTC().Format(time.RFC3339), apiURL, gateway, apiKey, nodeLine, signingLine)
	return os.WriteFile(path, []byte(body), 0o600)
}

func emitJSONOutput(out output, toStdout bool, filePath string) {
	data, err := json.Marshal(out)
	if err != nil {
		fatal("marshal json: %v", err)
	}
	if filePath != "" {
		if err := os.WriteFile(filePath, data, 0o600); err != nil {
			fatal("write output-json: %v", err)
		}
	}
	if toStdout {
		_, _ = os.Stdout.Write(data)
		_, _ = os.Stdout.Write([]byte("\n"))
	}
}

func fatal(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "provider_dev_token: "+format+"\n", args...)
	os.Exit(1)
}
