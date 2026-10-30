package custody

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/mr-tron/base58"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func randomKEK(t *testing.T) *LocalKEK {
	t.Helper()
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatal(err)
	}
	kek, err := NewLocalKEK(hex.EncodeToString(key))
	if err != nil {
		t.Fatal(err)
	}
	return kek
}

func TestNewLocalKEKRejectsBadKeys(t *testing.T) {
	for _, k := range []string{"", "abc", hex.EncodeToString(make([]byte, 16))} {
		if _, err := NewLocalKEK(k); !errors.Is(err, ErrKEKNotConfigured) {
			t.Fatalf("key %q: want ErrKEKNotConfigured, got %v", k, err)
		}
	}
}

func TestDefaultKEKRefusesStrictEnv(t *testing.T) {
	t.Setenv("EMBEDDED_WALLET_KEK", hex.EncodeToString(make([]byte, 32)))
	for _, env := range []string{"production", "prod", "staging", "testnet"} {
		t.Setenv("APP_ENV", env)
		if _, err := DefaultKEK(); !errors.Is(err, ErrLocalKEKInStrictEnv) {
			t.Fatalf("APP_ENV=%s: want ErrLocalKEKInStrictEnv, got %v", env, err)
		}
	}
	t.Setenv("APP_ENV", "development")
	if _, err := DefaultKEK(); err != nil {
		t.Fatalf("development: %v", err)
	}
}

func TestKEKWrapRoundTripAndTamper(t *testing.T) {
	kek := randomKEK(t)
	dek := []byte("0123456789abcdef0123456789abcdef")
	wrapped, err := kek.Wrap(dek)
	if err != nil {
		t.Fatal(err)
	}
	got, err := kek.Unwrap(wrapped)
	if err != nil || string(got) != string(dek) {
		t.Fatalf("round trip: %v %q", err, got)
	}
	wrapped[len(wrapped)-1] ^= 1
	if _, err := kek.Unwrap(wrapped); err == nil {
		t.Fatal("tampered wrap must fail")
	}
	if _, err := randomKEK(t).Unwrap(wrapped); err == nil {
		t.Fatal("other KEK must fail")
	}
}

func TestCreateWalletSignsAndKeepsKeySealed(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "embedded_wallets", "users", "wallets")
	user := testutil.CreateTestUser(t, testutil.UniqueEmail("custody"), "buyer")
	kek := randomKEK(t)

	row, err := CreateSolanaWallet(db.DB, kek, user.ID)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	pub, err := base58.Decode(row.Address)
	if err != nil || len(pub) != ed25519.PublicKeySize {
		t.Fatalf("address %q is not a Solana public key", row.Address)
	}
	// nonce(12) + 64-byte key + GCM tag(16): ciphertext, not the raw key
	if len(row.SealedKey) != 12+64+16 || row.KEKID != "local:v1" {
		t.Fatalf("unexpected sealed row: len=%d kek=%q", len(row.SealedKey), row.KEKID)
	}

	signer, err := NewSigner(db.DB, kek, user.ID)
	if err != nil {
		t.Fatalf("signer: %v", err)
	}
	msg := []byte("proxyhubb custody test")
	sig, err := signer.Sign(msg)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	if !ed25519.Verify(pub, msg, sig) {
		t.Fatal("signature does not verify against the wallet address")
	}

	// Wrong KEK (same ID, different key) must not sign.
	wrong, _ := NewSigner(db.DB, randomKEK(t), user.ID)
	if _, err := wrong.Sign(msg); err == nil {
		t.Fatal("wrong KEK must fail")
	}
}

func TestSealedKeyIsBoundToItsRow(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "embedded_wallets", "users", "wallets")
	kek := randomKEK(t)
	a := testutil.CreateTestUser(t, testutil.UniqueEmail("custody-a"), "buyer")
	b := testutil.CreateTestUser(t, testutil.UniqueEmail("custody-b"), "buyer")
	rowA, err := CreateSolanaWallet(db.DB, kek, a.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := CreateSolanaWallet(db.DB, kek, b.ID); err != nil {
		t.Fatal(err)
	}

	// Copy A's ciphertext onto B's row: the AAD (user_id|address) no longer matches.
	if err := db.DB.Model(&models.EmbeddedWallet{}).Where("user_id = ?", b.ID).
		Updates(map[string]interface{}{"sealed_key": rowA.SealedKey, "wrapped_dek": rowA.WrappedDEK}).Error; err != nil {
		t.Fatal(err)
	}
	signer, err := NewSigner(db.DB, kek, b.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := signer.Sign([]byte("x")); err == nil {
		t.Fatal("ciphertext moved to another user must not decrypt")
	}

	if _, err := NewSigner(db.DB, kek, uuid.New()); !errors.Is(err, ErrNoEmbeddedWallet) {
		t.Fatalf("unknown user: want ErrNoEmbeddedWallet, got %v", err)
	}
}
