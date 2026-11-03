package custody

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"hash/crc32"
	"io"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

const kmsTimeout = 10 * time.Second
const maxKMSBody = 16 * 1024

var cryptoKeyName = regexp.MustCompile(`^projects/[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}/locations/[a-z0-9-]{1,63}/keyRings/[a-zA-Z0-9_-]{1,63}/cryptoKeys/[a-zA-Z0-9_-]{1,63}$`)
var keyVersionNumber = regexp.MustCompile(`^[1-9][0-9]*$`)
var crcTable = crc32.MakeTable(crc32.Castagnoli)
var serviceAccountEmail = regexp.MustCompile(`^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,61}[a-z0-9]\.iam\.gserviceaccount\.com$`)

// GCPKEK wraps only 32-byte data keys using a dedicated ENCRYPT_DECRYPT key.
// Its stable ID names a CryptoKey, so primary-version rotation preserves reads.
// User signing keys remain operator-held and are decrypted in memory to sign.
type GCPKEK struct {
	key         string
	level       string
	client      *http.Client
	token       func(context.Context) (*oauth2.Token, error)
	adc         func(context.Context, string) (*oauth2.Token, error)
	impersonate string
}

// NewGCPKEK uses Application Default Credentials (workload identity in deployed
// environments). HSM is the default; SOFTWARE must be selected explicitly.
func NewGCPKEK(key, protectionLevel string) (*GCPKEK, error) {
	key = strings.TrimSpace(key)
	if !cryptoKeyName.MatchString(key) {
		return nil, fmt.Errorf("%w: expected an unversioned Cloud KMS CryptoKey resource", ErrKEKUnavailable)
	}
	if protectionLevel != "HSM" && protectionLevel != "SOFTWARE" {
		return nil, fmt.Errorf("%w: invalid KMS protection level", ErrKEKUnavailable)
	}
	client := &http.Client{Timeout: kmsTimeout, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	identity := strings.TrimSpace(os.Getenv("EMBEDDED_WALLET_GCP_KMS_SERVICE_ACCOUNT"))
	if identity != "" && !serviceAccountEmail.MatchString(identity) {
		return nil, fmt.Errorf("%w: invalid custody service account", ErrKEKUnavailable)
	}
	g := &GCPKEK{key: key, level: protectionLevel, client: client, impersonate: identity}
	g.adc = func(ctx context.Context, scope string) (*oauth2.Token, error) {
		ctx = context.WithValue(ctx, oauth2.HTTPClient, client)
		source, err := google.DefaultTokenSource(ctx, scope)
		if err != nil {
			return nil, ErrKEKUnavailable
		}
		return source.Token()
	}
	g.token = g.credentials
	return g, nil
}

// A dedicated custody identity can be impersonated from the VM workload
// identity. This avoids downloadable keys and preserves unrelated signers.
func (g *GCPKEK) credentials(ctx context.Context) (*oauth2.Token, error) {
	scope := "https://www.googleapis.com/auth/cloudkms"
	if g.impersonate != "" {
		scope = "https://www.googleapis.com/auth/cloud-platform"
	}
	base, err := g.adc(ctx, scope)
	if err != nil || base == nil || !base.Valid() {
		return nil, ErrKEKUnavailable
	}
	if g.impersonate == "" {
		return base, nil
	}
	body := []byte(`{"scope":["https://www.googleapis.com/auth/cloudkms"],"lifetime":"900s"}`)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/"+g.impersonate+":generateAccessToken", bytes.NewReader(body))
	if err != nil {
		return nil, ErrKEKUnavailable
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+base.AccessToken)
	resp, err := g.client.Do(req)
	if err != nil {
		return nil, ErrKEKUnavailable
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, ErrKEKUnavailable
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxKMSBody+1))
	defer zero(data)
	var out struct {
		Token  string    `json:"accessToken"`
		Expiry time.Time `json:"expireTime"`
	}
	if err != nil || len(data) > maxKMSBody || json.Unmarshal(data, &out) != nil || out.Token == "" || !out.Expiry.After(time.Now()) {
		return nil, ErrKEKUnavailable
	}
	return &oauth2.Token{AccessToken: out.Token, TokenType: "Bearer", Expiry: out.Expiry}, nil
}

func (g *GCPKEK) ID() string                      { return "gcp-kms:v1:" + g.key }
func (g *GCPKEK) aad() []byte                     { return []byte("proxyhubb/embedded-wallet/dek|" + g.ID()) }
func (g *GCPKEK) Wrap(b []byte) ([]byte, error)   { return g.WrapContext(context.Background(), b) }
func (g *GCPKEK) Unwrap(b []byte) ([]byte, error) { return g.UnwrapContext(context.Background(), b) }

func crcValue(b []byte) string { return strconv.FormatUint(uint64(crc32.Checksum(b, crcTable)), 10) }
func validCRC(raw json.RawMessage, b []byte) bool {
	s := string(raw)
	if len(s) > 1 && s[0] == '"' {
		if json.Unmarshal(raw, &s) != nil {
			return false
		}
	}
	v, err := strconv.ParseUint(s, 10, 32)
	return err == nil && uint32(v) == crc32.Checksum(b, crcTable)
}

func (g *GCPKEK) WrapContext(ctx context.Context, dek []byte) ([]byte, error) {
	if len(dek) != 32 {
		return nil, fmt.Errorf("%w: invalid data key size", ErrKEKUnavailable)
	}
	request := struct {
		Plaintext []byte `json:"plaintext"`
		AAD       []byte `json:"additionalAuthenticatedData"`
		CRC       string `json:"plaintextCrc32c"`
		AADCRC    string `json:"additionalAuthenticatedDataCrc32c"`
	}{dek, g.aad(), crcValue(dek), crcValue(g.aad())}
	var response struct {
		Name        string          `json:"name"`
		Ciphertext  []byte          `json:"ciphertext"`
		CRC         json.RawMessage `json:"ciphertextCrc32c"`
		Verified    bool            `json:"verifiedPlaintextCrc32c"`
		VerifiedAAD bool            `json:"verifiedAdditionalAuthenticatedDataCrc32c"`
		Level       string          `json:"protectionLevel"`
	}
	if err := g.call(ctx, "encrypt", request, &response); err != nil {
		return nil, err
	}
	version := strings.TrimPrefix(response.Name, g.key+"/cryptoKeyVersions/")
	if !strings.HasPrefix(response.Name, g.key+"/cryptoKeyVersions/") || !keyVersionNumber.MatchString(version) || !response.Verified || !response.VerifiedAAD || response.Level != g.level || len(response.Ciphertext) == 0 || len(response.Ciphertext) > 8192 || !validCRC(response.CRC, response.Ciphertext) {
		return nil, fmt.Errorf("%w: KMS encryption integrity check failed", ErrKEKUnavailable)
	}
	return response.Ciphertext, nil
}

func (g *GCPKEK) UnwrapContext(ctx context.Context, wrapped []byte) ([]byte, error) {
	if len(wrapped) == 0 || len(wrapped) > 8192 {
		return nil, fmt.Errorf("%w: invalid wrapped key size", ErrKEKUnavailable)
	}
	request := struct {
		Ciphertext []byte `json:"ciphertext"`
		AAD        []byte `json:"additionalAuthenticatedData"`
		CRC        string `json:"ciphertextCrc32c"`
		AADCRC     string `json:"additionalAuthenticatedDataCrc32c"`
	}{wrapped, g.aad(), crcValue(wrapped), crcValue(g.aad())}
	var response struct {
		Plaintext []byte          `json:"plaintext"`
		CRC       json.RawMessage `json:"plaintextCrc32c"`
		Level     string          `json:"protectionLevel"`
	}
	if err := g.call(ctx, "decrypt", request, &response); err != nil {
		zero(response.Plaintext)
		return nil, err
	}
	if response.Level != g.level || len(response.Plaintext) != 32 || !validCRC(response.CRC, response.Plaintext) {
		zero(response.Plaintext)
		return nil, fmt.Errorf("%w: KMS decryption integrity check failed", ErrKEKUnavailable)
	}
	return response.Plaintext, nil
}

func (g *GCPKEK) call(ctx context.Context, operation string, input, output any) error {
	ctx, cancel := context.WithTimeout(ctx, kmsTimeout)
	defer cancel()
	if ctx.Err() != nil {
		return ErrKEKUnavailable
	}
	token, err := g.token(ctx)
	if err != nil || token == nil || !token.Valid() {
		return fmt.Errorf("%w: KMS credentials unavailable", ErrKEKUnavailable)
	}
	body, err := json.Marshal(input)
	if err != nil {
		return ErrKEKUnavailable
	}
	defer zero(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://cloudkms.googleapis.com/v1/"+g.key+":"+operation, bytes.NewReader(body))
	if err != nil {
		return ErrKEKUnavailable
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token.AccessToken)
	resp, err := g.client.Do(req)
	if err != nil {
		return fmt.Errorf("%w: KMS request failed", ErrKEKUnavailable)
	}
	defer resp.Body.Close()
	// Do not propagate provider error bodies, URLs, tokens or plaintext to logs.
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%w: KMS HTTP %d", ErrKEKUnavailable, resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxKMSBody+1))
	defer zero(data)
	if err != nil || len(data) > maxKMSBody || json.Unmarshal(data, output) != nil {
		return fmt.Errorf("%w: invalid KMS response", ErrKEKUnavailable)
	}
	return nil
}
