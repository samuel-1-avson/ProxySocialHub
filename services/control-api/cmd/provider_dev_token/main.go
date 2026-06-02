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
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/joho/godotenv"
	"github.com/proxyhubb/control-api/internal/crypto"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

type output struct {
	Token     string `json:"token"`
	UserID    string `json:"user_id"`
	TokenID   string `json:"token_id"`
	TokenName string `json:"token_name"`
	TomlPath  string `json:"toml_path,omitempty"`
}

func main() {
	envFile := flag.String("env-file", "", "path to .env (default: search repo root)")
	userID := flag.String("user", "", "profile/user UUID (default: latest provider profile)")
	tokenName := flag.String("name", "dev-local-cli", "token label in DB")
	writeToml := flag.String("write-toml", "", "write provider.toml (default path if flag set with no value)")
	skipToml := flag.Bool("no-write-toml", false, "only print token; do not write provider.toml")
	apiURL := flag.String("api-url", "http://localhost:18080", "control_api_url for generated toml")
	gatewayAddr := flag.String("gateway", "localhost:3128", "gateway_addr for generated toml")
	jsonOut := flag.Bool("json", false, "print machine-readable JSON on stdout")
	flag.Parse()

	loadEnv(*envFile)

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

	uid, err := resolveUserID(*userID)
	if err != nil {
		fatal("%v", err)
	}

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

	out := output{
		Token:     raw,
		UserID:    uid.String(),
		TokenID:   record.ID.String(),
		TokenName: record.Name,
	}

	if !*skipToml {
		tomlPath := *writeToml
		if tomlPath == "" {
			tomlPath = defaultTomlPath()
		}
		nodeID := lookupProviderNodeID(uid)
		if err := writeProviderToml(tomlPath, *apiURL, *gatewayAddr, raw, nodeID); err != nil {
			fatal("write toml: %v", err)
		}
		out.TomlPath = tomlPath
	}

	if *jsonOut {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(out)
		return
	}

	fmt.Println("--------------------------------------------------")
	fmt.Println("Dev provider token (local only - do not commit)")
	fmt.Println("--------------------------------------------------")
	fmt.Printf("Token:    %s\n", out.Token)
	fmt.Printf("User:     %s\n", out.UserID)
	fmt.Printf("Token ID: %s\n", out.TokenID)
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

func resolveUserID(flag string) (uuid.UUID, error) {
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
		return uuid.Nil, fmt.Errorf("no profile in DB — sign up once or pass -user <uuid>")
	}
	return uuid.Parse(id)
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
	if home, err := os.UserHomeDir(); err == nil {
		return filepath.Join(home, ".proxyhubb", "provider.toml")
	}
	return "provider.toml"
}

func writeProviderToml(path, apiURL, gateway, apiKey, nodeID string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	nodeLine := ""
	if nodeID != "" {
		nodeLine = fmt.Sprintf("node_id = %q\n", nodeID)
	}
	body := fmt.Sprintf(`# Generated by provider_dev_token at %s — dev/local only
control_api_url = %q
gateway_addr = %q
api_key = %q
%sconnection_type = "residential"
use_tls = false
metrics_port = 9090
`, time.Now().UTC().Format(time.RFC3339), apiURL, gateway, apiKey, nodeLine)
	return os.WriteFile(path, []byte(body), 0o600)
}

func fatal(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "provider_dev_token: "+format+"\n", args...)
	os.Exit(1)
}
