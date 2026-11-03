package custody

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"strings"
)

// KEK wraps and unwraps per-wallet data keys (envelope encryption).
type KEK interface {
	// ID is stored next to each wrapped key so a later key or KMS can be told apart.
	ID() string
	Wrap(dek []byte) ([]byte, error)
	Unwrap(wrapped []byte) ([]byte, error)
}

var (
	// ErrKEKNotConfigured means EMBEDDED_WALLET_KEK is missing or malformed.
	ErrKEKNotConfigured = errors.New("custody: EMBEDDED_WALLET_KEK must be 32 bytes, hex encoded")
	ErrKEKUnavailable   = errors.New("custody: key management unavailable")
	ErrUnknownKEK       = errors.New("custody: wallet key is not in the configured key ring")
	// ErrLocalKEKInStrictEnv refuses an env-var key outside local development
	// (docs/custody-split.md: no raw key material in env for real funds).
	ErrLocalKEKInStrictEnv = errors.New("custody: local EMBEDDED_WALLET_KEK is not allowed in production/staging/testnet; use KMS")
)

// LocalKEK is an AES-256-GCM key-encryption key read from the environment.
// It is deliberately separate from ENCRYPTION_KEY (which protects emails and PII).
type LocalKEK struct {
	aead cipher.AEAD
}

const localKEKID = "local:v1"

// wrapAAD binds a wrapped data key to the KEK that wrapped it.
var wrapAAD = []byte("proxyhubb/embedded-wallet/dek|" + localKEKID)

// NewLocalKEK parses a 64-char hex key.
func NewLocalKEK(hexKey string) (*LocalKEK, error) {
	key, err := hex.DecodeString(strings.TrimSpace(hexKey))
	if err != nil || len(key) != 32 {
		return nil, ErrKEKNotConfigured
	}
	defer zero(key)
	aead, err := newGCM(key)
	if err != nil {
		return nil, err
	}
	return &LocalKEK{aead: aead}, nil
}

func (k *LocalKEK) ID() string { return localKEKID }

func (k *LocalKEK) Wrap(dek []byte) ([]byte, error) {
	return seal(k.aead, dek, wrapAAD)
}

func (k *LocalKEK) Unwrap(wrapped []byte) ([]byte, error) {
	return open(k.aead, wrapped, wrapAAD)
}

func newGCM(key []byte) (cipher.AEAD, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// seal returns nonce || ciphertext.
func seal(aead cipher.AEAD, plaintext, aad []byte) ([]byte, error) {
	nonce := make([]byte, aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	return aead.Seal(nonce, nonce, plaintext, aad), nil
}

func open(aead cipher.AEAD, sealed, aad []byte) ([]byte, error) {
	if len(sealed) < aead.NonceSize() {
		return nil, fmt.Errorf("custody: ciphertext too short")
	}
	nonce, ct := sealed[:aead.NonceSize()], sealed[aead.NonceSize():]
	out, err := aead.Open(nil, nonce, ct, aad)
	if err != nil {
		return nil, fmt.Errorf("custody: decrypt failed: %w", err)
	}
	return out, nil
}
