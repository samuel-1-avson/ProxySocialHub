// Package custody creates and holds Solana wallets for users who sign in without a
// crypto wallet (e.g. Google sign-in). Keys are stored with envelope encryption:
//
//	private key --AES-256-GCM(random DEK, AAD=user_id|address)--> sealed_key
//	DEK         --KEK.Wrap-------------------------------------> wrapped_dek
//
// Plaintext keys only exist in memory while creating a wallet or signing.
// Nothing in this package returns or exports a private key.
package custody

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"fmt"
	"io"

	"github.com/google/uuid"
	"github.com/mr-tron/base58"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
)

// ErrNoEmbeddedWallet means the user has no server-held wallet.
var ErrNoEmbeddedWallet = errors.New("custody: user has no embedded wallet")

func keyAAD(userID uuid.UUID, address string) []byte {
	return []byte("proxyhubb/embedded-wallet/key|" + userID.String() + "|" + address)
}

func zero(b []byte) {
	for i := range b {
		b[i] = 0
	}
}

// CreateSolanaWallet generates a Solana keypair for userID, stores it sealed, and
// returns the stored row. Run it inside the signup transaction.
func CreateSolanaWallet(tx *gorm.DB, kek KEK, userID uuid.UUID) (models.EmbeddedWallet, error) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return models.EmbeddedWallet{}, err
	}
	defer zero(priv)
	address := base58.Encode(pub)

	dek := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, dek); err != nil {
		return models.EmbeddedWallet{}, err
	}
	defer zero(dek)

	aead, err := newGCM(dek)
	if err != nil {
		return models.EmbeddedWallet{}, err
	}
	sealedKey, err := seal(aead, priv, keyAAD(userID, address))
	if err != nil {
		return models.EmbeddedWallet{}, err
	}
	wrappedDEK, err := wrapContext(tx.Statement.Context, kek, dek)
	if err != nil {
		return models.EmbeddedWallet{}, err
	}
	// Do not commit a wallet with an unreadable key (e.g. encrypt-only IAM).
	recovered, err := unwrapContext(tx.Statement.Context, kek, wrappedDEK)
	if err != nil {
		return models.EmbeddedWallet{}, err
	}
	defer zero(recovered)
	if !bytes.Equal(recovered, dek) {
		return models.EmbeddedWallet{}, fmt.Errorf("%w: wallet key recovery check failed", ErrKEKUnavailable)
	}

	row := models.EmbeddedWallet{
		ID:         uuid.New(),
		UserID:     userID,
		Chain:      "solana",
		Address:    address,
		SealedKey:  sealedKey,
		WrappedDEK: wrappedDEK,
		KEKID:      kek.ID(),
	}
	if err := tx.Create(&row).Error; err != nil {
		return models.EmbeddedWallet{}, err
	}
	return row, nil
}

// FindWallet returns the user's embedded wallet row (ciphertext only).
func FindWallet(db *gorm.DB, userID uuid.UUID) (models.EmbeddedWallet, error) {
	var row models.EmbeddedWallet
	if err := db.Where("user_id = ?", userID).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return models.EmbeddedWallet{}, ErrNoEmbeddedWallet
		}
		return models.EmbeddedWallet{}, err
	}
	return row, nil
}

// Signer signs messages with a user's embedded wallet. It decrypts the key for
// each signature and wipes it afterwards; any decrypt failure is an error.
type Signer struct {
	row models.EmbeddedWallet
	kek KEK
	ctx context.Context
}

// NewSigner loads the user's wallet for signing.
func NewSigner(db *gorm.DB, kek KEK, userID uuid.UUID) (*Signer, error) {
	row, err := FindWallet(db, userID)
	if err != nil {
		return nil, err
	}
	reader, err := resolveKey(kek, row.KEKID)
	if err != nil {
		return nil, err
	}
	return &Signer{row: row, kek: reader, ctx: db.Statement.Context}, nil
}

// Address is the wallet's base58 Solana address.
func (s *Signer) Address() string { return s.row.Address }

// Sign returns an ed25519 signature over msg.
func (s *Signer) Sign(msg []byte) ([]byte, error) {
	ctx := s.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	return s.SignContext(ctx, msg)
}

func (s *Signer) SignContext(ctx context.Context, msg []byte) ([]byte, error) {
	dek, err := unwrapContext(ctx, s.kek, s.row.WrappedDEK)
	if err != nil {
		return nil, err
	}
	defer zero(dek)
	aead, err := newGCM(dek)
	if err != nil {
		return nil, err
	}
	priv, err := open(aead, s.row.SealedKey, keyAAD(s.row.UserID, s.row.Address))
	if err != nil {
		return nil, err
	}
	defer zero(priv)
	if len(priv) != ed25519.PrivateKeySize {
		return nil, fmt.Errorf("custody: sealed key has wrong length")
	}
	if base58.Encode(ed25519.PrivateKey(priv).Public().(ed25519.PublicKey)) != s.row.Address {
		return nil, fmt.Errorf("custody: sealed key does not match wallet address")
	}
	return ed25519.Sign(ed25519.PrivateKey(priv), msg), nil
}
