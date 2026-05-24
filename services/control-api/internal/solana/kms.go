package solana

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	sol "github.com/gagliardetto/solana-go"
)

// HSMSigner defines the interface for hardware security module / key signing.
type HSMSigner interface {
	PublicKey() sol.PublicKey
	Sign(ctx context.Context, message []byte) ([]byte, error)
}

// MockHSMSigner is a software fallback that implements HSMSigner for testing and dev.
type MockHSMSigner struct {
	privateKey sol.PrivateKey
}

func NewMockHSMSigner(privateKey sol.PrivateKey) *MockHSMSigner {
	return &MockHSMSigner{privateKey: privateKey}
}

func (m *MockHSMSigner) PublicKey() sol.PublicKey {
	return m.privateKey.PublicKey()
}

func (m *MockHSMSigner) Sign(ctx context.Context, message []byte) ([]byte, error) {
	// Sign using Go standard library ed25519 package
	return ed25519.Sign(ed25519.PrivateKey(m.privateKey), message), nil
}

// AWSKMSSigner implements HSMSigner using the AWS KMS REST API.
// It avoids external AWS SDK dependencies to ensure clean compilations.
type AWSKMSSigner struct {
	keyID     string
	pubKey    sol.PublicKey
	accessKey string
	secretKey string
	token     string // Session token (optional)
	region    string
	client    *http.Client
}

// NewAWSKMSSigner creates a new AWS KMSSigner using environment credentials.
func NewAWSKMSSigner(keyID string, pubKey sol.PublicKey) (*AWSKMSSigner, error) {
	accessKey := os.Getenv("AWS_ACCESS_KEY_ID")
	secretKey := os.Getenv("AWS_SECRET_ACCESS_KEY")
	token := os.Getenv("AWS_SESSION_TOKEN")
	region := os.Getenv("AWS_REGION")
	if region == "" {
		region = "us-east-1"
	}

	if accessKey == "" || secretKey == "" {
		return nil, fmt.Errorf("missing AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY")
	}

	return &AWSKMSSigner{
		keyID:     keyID,
		pubKey:    pubKey,
		accessKey: accessKey,
		secretKey: secretKey,
		token:     token,
		region:    region,
		client:    &http.Client{Timeout: 10 * time.Second},
	}, nil
}

func (a *AWSKMSSigner) PublicKey() sol.PublicKey {
	return a.pubKey
}

func (a *AWSKMSSigner) Sign(ctx context.Context, message []byte) ([]byte, error) {
	endpoint := fmt.Sprintf("https://kms.%s.amazonaws.com/", a.region)

	// Build request payload
	reqPayload := map[string]interface{}{
		"KeyId":            a.keyID,
		"Message":          base64.StdEncoding.EncodeToString(message),
		"MessageType":      "RAW",
		"SigningAlgorithm": "ED25519",
	}
	bodyBytes, err := json.Marshal(reqPayload)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal KMS sign request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("failed to create KMS http request: %w", err)
	}

	req.Header.Set("Content-Type", "application/x-amz-json-1.1")
	req.Header.Set("X-Amz-Target", "TrentService.Sign")

	// Sign the request using AWS Signature Version 4
	a.signSigV4(req, bodyBytes)

	resp, err := a.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("KMS request failed: %w", err)
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read KMS response body: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("KMS sign error (status %d): %s", resp.StatusCode, string(respBytes))
	}

	var signResp struct {
		Signature string `json:"Signature"`
	}
	if err := json.Unmarshal(respBytes, &signResp); err != nil {
		return nil, fmt.Errorf("failed to decode KMS response: %w", err)
	}

	sigBytes, err := base64.StdEncoding.DecodeString(signResp.Signature)
	if err != nil {
		return nil, fmt.Errorf("failed to decode KMS signature base64: %w", err)
	}

	return sigBytes, nil
}

// signSigV4 adds AWS Signature Version 4 headers to the request.
func (a *AWSKMSSigner) signSigV4(req *http.Request, body []byte) {
	t := time.Now().UTC()
	amzDate := t.Format("20060102T150405Z")
	dateStamp := t.Format("20060102")

	req.Header.Set("X-Amz-Date", amzDate)
	if a.token != "" {
		req.Header.Set("X-Amz-Security-Token", a.token)
	}

	// 1. Create Canonical Request
	host := req.Host
	if host == "" {
		host = req.URL.Host
	}

	canonicalHeaders := fmt.Sprintf("content-type:%s\nhost:%s\nx-amz-date:%s\n",
		req.Header.Get("Content-Type"), host, amzDate)
	signedHeaders := "content-type;host;x-amz-date"

	if a.token != "" {
		canonicalHeaders += fmt.Sprintf("x-amz-security-token:%s\n", a.token)
		signedHeaders += ";x-amz-security-token"
	}

	payloadHash := sha256.Sum256(body)
	canonicalRequest := fmt.Sprintf("POST\n/\n\n%s\n%s\n%s",
		canonicalHeaders, signedHeaders, hex.EncodeToString(payloadHash[:]))

	canonicalRequestHash := sha256.Sum256([]byte(canonicalRequest))

	// 2. Create String to Sign
	credentialScope := fmt.Sprintf("%s/%s/kms/aws4_request", dateStamp, a.region)
	stringToSign := fmt.Sprintf("AWS4-HMAC-SHA256\n%s\n%s\n%s",
		amzDate, credentialScope, hex.EncodeToString(canonicalRequestHash[:]))

	// 3. Calculate Signature
	signingKey := getSignatureKey(a.secretKey, dateStamp, a.region, "kms")
	signature := hmacSHA256(signingKey, []byte(stringToSign))

	// 4. Add Authorization Header
	authHeader := fmt.Sprintf("AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		a.accessKey, credentialScope, signedHeaders, hex.EncodeToString(signature))

	req.Header.Set("Authorization", authHeader)
}

func hmacSHA256(key []byte, data []byte) []byte {
	h := hmac.New(sha256.New, key)
	h.Write(data)
	return h.Sum(nil)
}

func getSignatureKey(key string, dateStamp string, regionName string, serviceName string) []byte {
	kDate := hmacSHA256([]byte("AWS4"+key), []byte(dateStamp))
	kRegion := hmacSHA256(kDate, []byte(regionName))
	kService := hmacSHA256(kRegion, []byte(serviceName))
	kSigning := hmacSHA256(kService, []byte("aws4_request"))
	return kSigning
}

// GenerateRandomKeypair creates a random keypair for testing when local file does not exist.
func GenerateRandomKeypair() (sol.PrivateKey, error) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	_ = pub
	out := make(sol.PrivateKey, 64)
	copy(out, priv)
	return out, nil
}
