package custody

import (
	"bytes"
	"context"
	"crypto/rand"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"
)

func strictEnv() bool {
	for _, name := range []string{"APP_ENV", "ENVIRONMENT"} {
		switch strings.ToLower(strings.TrimSpace(os.Getenv(name))) {
		case "production", "prod", "staging", "testnet":
			return true
		}
	}
	return false
}

// KeyRing writes with its active key and reads only explicitly configured keys.
// Stored database IDs never determine a KMS destination or credential source.
type KeyRing struct {
	active KEK
	keys   map[string]KEK
}

func NewKeyRing(active KEK, readers ...KEK) (*KeyRing, error) {
	if active == nil || active.ID() == "" {
		return nil, ErrUnknownKEK
	}
	r := &KeyRing{active: active, keys: map[string]KEK{active.ID(): active}}
	if parent, ok := active.(*KeyRing); ok {
		r.active = parent.active
		for id, key := range parent.keys {
			r.keys[id] = key
		}
	}
	for _, k := range readers {
		if k == nil || k.ID() == "" {
			return nil, ErrUnknownKEK
		}
		if _, exists := r.keys[k.ID()]; exists {
			return nil, fmt.Errorf("%w: duplicate key ID", ErrKEKUnavailable)
		}
		r.keys[k.ID()] = k
	}
	return r, nil
}

func (r *KeyRing) ID() string                      { return r.active.ID() }
func (r *KeyRing) Wrap(b []byte) ([]byte, error)   { return r.active.Wrap(b) }
func (r *KeyRing) Unwrap(b []byte) ([]byte, error) { return r.active.Unwrap(b) }
func (r *KeyRing) keyForID(id string) (KEK, error) {
	k, ok := r.keys[id]
	if !ok {
		return nil, ErrUnknownKEK
	}
	return k, nil
}

func resolveKey(k KEK, id string) (KEK, error) {
	if k == nil {
		return nil, ErrUnknownKEK
	}
	if r, ok := k.(*KeyRing); ok {
		return r.keyForID(id)
	}
	if k.ID() != id {
		return nil, ErrUnknownKEK
	}
	return k, nil
}

// DefaultKEK performs configuration validation only. Encryption/decryption and
// Ready verify credentials and IAM; a configured resource alone is not readiness.
func DefaultKEK() (KEK, error) {
	provider := strings.TrimSpace(os.Getenv("EMBEDDED_WALLET_KEK_PROVIDER"))
	switch provider {
	case "", "local":
		if strictEnv() {
			return nil, ErrLocalKEKInStrictEnv
		}
		return NewLocalKEK(os.Getenv("EMBEDDED_WALLET_KEK"))
	case "gcp-kms":
		level := strings.TrimSpace(os.Getenv("EMBEDDED_WALLET_KMS_PROTECTION_LEVEL"))
		if level == "" {
			level = "HSM"
		}
		active, err := NewGCPKEK(os.Getenv("EMBEDDED_WALLET_GCP_KMS_KEY"), level)
		if err != nil {
			return nil, err
		}
		var readers []KEK
		names := strings.TrimSpace(os.Getenv("EMBEDDED_WALLET_GCP_KMS_READ_KEYS"))
		if names != "" {
			if len(strings.Split(names, ",")) > 8 {
				return nil, fmt.Errorf("%w: too many read keys", ErrKEKUnavailable)
			}
			for _, name := range strings.Split(names, ",") {
				k, err := NewGCPKEK(strings.TrimSpace(name), level)
				if err != nil {
					return nil, err
				}
				readers = append(readers, k)
			}
		}
		return NewKeyRing(active, readers...)
	default:
		return nil, fmt.Errorf("%w: unsupported KEK provider", ErrKEKUnavailable)
	}
}

// Ready verifies a random data key can be wrapped and recovered. No wallet or
// funds are involved. Public capability requests share one bounded probe.
var readiness struct {
	sync.Mutex
	id    string
	until time.Time
	err   error
}

func Ready(ctx context.Context) error {
	k, err := DefaultKEK()
	if err != nil {
		return err
	}
	if _, local := k.(*LocalKEK); local {
		return nil
	}
	id := k.ID() + "|" + os.Getenv("EMBEDDED_WALLET_KMS_PROTECTION_LEVEL") + "|" + os.Getenv("EMBEDDED_WALLET_GCP_KMS_SERVICE_ACCOUNT")
	readiness.Lock()
	defer readiness.Unlock()
	if readiness.id == id && time.Now().Before(readiness.until) {
		return readiness.err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	err = Probe(ctx, k)
	ttl := 30 * time.Second
	if err != nil {
		ttl = 5 * time.Second
	}
	readiness.id, readiness.until, readiness.err = id, time.Now().Add(ttl), err
	return err
}

func Probe(ctx context.Context, k KEK) error {
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return ErrKEKUnavailable
	}
	defer zero(key)
	wrapped, err := wrapContext(ctx, k, key)
	if err != nil {
		return err
	}
	got, err := unwrapContext(ctx, k, wrapped)
	if err != nil {
		return err
	}
	defer zero(got)
	if !bytes.Equal(key, got) {
		return fmt.Errorf("%w: key recovery check failed", ErrKEKUnavailable)
	}
	return nil
}

type contextKEK interface {
	WrapContext(context.Context, []byte) ([]byte, error)
	UnwrapContext(context.Context, []byte) ([]byte, error)
}

func wrapContext(ctx context.Context, k KEK, b []byte) ([]byte, error) {
	if r, ok := k.(*KeyRing); ok {
		k = r.active
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if c, ok := k.(contextKEK); ok {
		return c.WrapContext(ctx, b)
	}
	return k.Wrap(b)
}

func unwrapContext(ctx context.Context, k KEK, b []byte) ([]byte, error) {
	if r, ok := k.(*KeyRing); ok {
		k = r.active
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if c, ok := k.(contextKEK); ok {
		return c.UnwrapContext(ctx, b)
	}
	return k.Unwrap(b)
}
