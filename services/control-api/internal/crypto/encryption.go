// Package crypto provides encryption utilities for sensitive data at rest
package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"sync"
)

var (
	// Global encryption key (loaded from env)
	encryptionKey []byte
	keyOnce       sync.Once
	keyErr        error

	ErrKeyNotSet     = errors.New("encryption key not set (ENCRYPTION_KEY env var)")
	ErrKeyInvalidLen = errors.New("encryption key must be 32 bytes (256 bit)")
	ErrCiphertext    = errors.New("ciphertext too short")
)

// InitEncryption initializes the encryption key from environment
func InitEncryption() error {
	keyOnce.Do(func() {
		keyStr := os.Getenv("ENCRYPTION_KEY")
		if keyStr == "" {
			keyErr = ErrKeyNotSet
			return
		}

		// Try hex decoding first (64-char hex → 32 bytes, format used in .env)
		if len(keyStr) == 64 {
			key, err := hex.DecodeString(keyStr)
			if err == nil && len(key) == 32 {
				encryptionKey = key
				return
			}
		}

		// Try base64 decoding
		key, err := base64.StdEncoding.DecodeString(keyStr)
		if err == nil {
			if len(key) != 32 {
				keyErr = ErrKeyInvalidLen
				return
			}
			encryptionKey = key
			return
		}

		// Try raw 32-byte string
		if len(keyStr) == 32 {
			encryptionKey = []byte(keyStr)
			return
		}

		keyErr = ErrKeyInvalidLen
	})

	return keyErr
}

// Encrypt encrypts plaintext using AES-256-GCM
func Encrypt(plaintext string) (string, error) {
	if encryptionKey == nil {
		if err := InitEncryption(); err != nil {
			return "", err
		}
	}

	block, err := aes.NewCipher(encryptionKey)
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}

	ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(ciphertext), nil
}

// Decrypt decrypts ciphertext encrypted with Encrypt
func Decrypt(ciphertext string) (string, error) {
	if encryptionKey == nil {
		if err := InitEncryption(); err != nil {
			return "", err
		}
	}

	data, err := base64.StdEncoding.DecodeString(ciphertext)
	if err != nil {
		return "", err
	}

	block, err := aes.NewCipher(encryptionKey)
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonceSize := gcm.NonceSize()
	if len(data) < nonceSize {
		return "", ErrCiphertext
	}

	nonce, ciphertextBytes := data[:nonceSize], data[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, ciphertextBytes, nil)
	if err != nil {
		return "", err
	}

	return string(plaintext), nil
}

// EncryptBytes encrypts bytes using AES-256-GCM
func EncryptBytes(plaintext []byte) ([]byte, error) {
	if encryptionKey == nil {
		if err := InitEncryption(); err != nil {
			return nil, err
		}
	}

	block, err := aes.NewCipher(encryptionKey)
	if err != nil {
		return nil, err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}

	return gcm.Seal(nonce, nonce, plaintext, nil), nil
}

// DecryptBytes decrypts bytes encrypted with EncryptBytes
func DecryptBytes(ciphertext []byte) ([]byte, error) {
	if encryptionKey == nil {
		if err := InitEncryption(); err != nil {
			return nil, err
		}
	}

	block, err := aes.NewCipher(encryptionKey)
	if err != nil {
		return nil, err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	nonceSize := gcm.NonceSize()
	if len(ciphertext) < nonceSize {
		return nil, ErrCiphertext
	}

	nonce, ciphertextBytes := ciphertext[:nonceSize], ciphertext[nonceSize:]
	return gcm.Open(nil, nonce, ciphertextBytes, nil)
}

// GenerateKey generates a new random 32-byte encryption key
// Returns base64-encoded key suitable for ENCRYPTION_KEY env var
func GenerateKey() (string, error) {
	key := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, key); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(key), nil
}
