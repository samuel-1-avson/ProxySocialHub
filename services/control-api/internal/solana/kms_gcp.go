package solana

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

const cloudKMSScope = "https://www.googleapis.com/auth/cloudkms"

// GCPKMSSigner implements HSMSigner via Cloud KMS asymmetricSign (EC_SIGN_ED25519).
type GCPKMSSigner struct {
	keyName string // full cryptoKeyVersions resource name
	pubKey  sol.PublicKey
	token   oauth2.TokenSource
	client  *http.Client
}

// NewGCPKMSSigner creates a signer using Application Default Credentials.
// keyName must be projects/.../locations/.../keyRings/.../cryptoKeys/.../cryptoKeyVersions/N
// pubKeyBase58 may be empty; then the public key is fetched from Cloud KMS.
func NewGCPKMSSigner(ctx context.Context, keyName, pubKeyBase58 string) (*GCPKMSSigner, error) {
	keyName = strings.TrimSpace(keyName)
	if keyName == "" {
		return nil, fmt.Errorf("GCP_KMS_KEY_NAME is required")
	}
	if !strings.Contains(keyName, "/cryptoKeyVersions/") {
		return nil, fmt.Errorf("GCP_KMS_KEY_NAME must include cryptoKeyVersions/N")
	}

	ts, err := google.DefaultTokenSource(ctx, cloudKMSScope)
	if err != nil {
		return nil, fmt.Errorf("GCP ADC token source: %w", err)
	}

	s := &GCPKMSSigner{
		keyName: keyName,
		token:   ts,
		client:  &http.Client{Timeout: 15 * time.Second},
	}

	pubKeyBase58 = strings.TrimSpace(pubKeyBase58)
	if pubKeyBase58 != "" {
		pk, err := sol.PublicKeyFromBase58(pubKeyBase58)
		if err != nil {
			return nil, fmt.Errorf("invalid GCP_KMS_PUBLIC_KEY: %w", err)
		}
		s.pubKey = pk
	} else {
		pk, err := s.fetchPublicKey(ctx)
		if err != nil {
			return nil, err
		}
		s.pubKey = pk
	}
	return s, nil
}

func (g *GCPKMSSigner) PublicKey() sol.PublicKey {
	return g.pubKey
}

func (g *GCPKMSSigner) Sign(ctx context.Context, message []byte) ([]byte, error) {
	tok, err := g.token.Token()
	if err != nil {
		return nil, fmt.Errorf("GCP KMS token: %w", err)
	}

	payload := map[string]interface{}{
		"data": base64.StdEncoding.EncodeToString(message),
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	url := "https://cloudkms.googleapis.com/v1/" + g.keyName + ":asymmetricSign"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+tok.AccessToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := g.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("GCP KMS sign request: %w", err)
	}
	defer resp.Body.Close()
	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GCP KMS sign error (status %d): %s", resp.StatusCode, string(respBytes))
	}

	var out struct {
		Signature string `json:"signature"`
	}
	if err := json.Unmarshal(respBytes, &out); err != nil {
		return nil, fmt.Errorf("GCP KMS sign decode: %w", err)
	}
	sig, err := base64.StdEncoding.DecodeString(out.Signature)
	if err != nil {
		return nil, fmt.Errorf("GCP KMS signature base64: %w", err)
	}
	if len(sig) != ed25519.SignatureSize {
		return nil, fmt.Errorf("GCP KMS signature length %d, want %d", len(sig), ed25519.SignatureSize)
	}
	return sig, nil
}

func (g *GCPKMSSigner) fetchPublicKey(ctx context.Context) (sol.PublicKey, error) {
	tok, err := g.token.Token()
	if err != nil {
		return sol.PublicKey{}, fmt.Errorf("GCP KMS token: %w", err)
	}
	url := "https://cloudkms.googleapis.com/v1/" + g.keyName + "/publicKey"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return sol.PublicKey{}, err
	}
	req.Header.Set("Authorization", "Bearer "+tok.AccessToken)

	resp, err := g.client.Do(req)
	if err != nil {
		return sol.PublicKey{}, err
	}
	defer resp.Body.Close()
	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return sol.PublicKey{}, err
	}
	if resp.StatusCode != http.StatusOK {
		return sol.PublicKey{}, fmt.Errorf("GCP KMS getPublicKey (status %d): %s", resp.StatusCode, string(respBytes))
	}

	var out struct {
		Pem string `json:"pem"`
	}
	if err := json.Unmarshal(respBytes, &out); err != nil {
		return sol.PublicKey{}, err
	}
	return solanaPubkeyFromPEM(out.Pem)
}

func solanaPubkeyFromPEM(pemStr string) (sol.PublicKey, error) {
	block, _ := pem.Decode([]byte(pemStr))
	if block == nil {
		return sol.PublicKey{}, fmt.Errorf("GCP KMS public key PEM decode failed")
	}
	pubAny, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return sol.PublicKey{}, fmt.Errorf("GCP KMS public key parse: %w", err)
	}
	edPub, ok := pubAny.(ed25519.PublicKey)
	if !ok {
		return sol.PublicKey{}, fmt.Errorf("GCP KMS public key is not Ed25519")
	}
	if len(edPub) != sol.PublicKeyLength {
		return sol.PublicKey{}, fmt.Errorf("Ed25519 pubkey length %d", len(edPub))
	}
	var pk sol.PublicKey
	copy(pk[:], edPub)
	return pk, nil
}

// gcpKMSStrictEnv is true when oracle KMS init must fail closed.
func gcpKMSStrictEnv() bool {
	env := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
	if env == "production" || env == "prod" || env == "staging" || env == "testnet" {
		return true
	}
	return strings.EqualFold(strings.TrimSpace(os.Getenv("PROXYHUB_REQUIRE_GCP_KMS")), "true")
}

// gcpKMSHotStrictEnv is true when treasury-hot KMS init must fail closed (Sprint G).
func gcpKMSHotStrictEnv() bool {
	if strings.EqualFold(strings.TrimSpace(os.Getenv("PROXYHUB_REQUIRE_GCP_KMS_HOT")), "true") {
		return true
	}
	env := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
	return env == "production" || env == "prod" || env == "staging" || env == "testnet"
}
