// Package crypto provides credential encryption services
package crypto

import (
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// CredentialService handles secure credential storage and retrieval
type CredentialService struct{}

// NewCredentialService creates a new credential service
func NewCredentialService() *CredentialService {
	return &CredentialService{}
}

// StoreCredentials encrypts and stores session credentials
func (s *CredentialService) StoreCredentials(sessionID uuid.UUID, username, password string) error {
	// Encrypt credentials
	usernameEnc, err := Encrypt(username)
	if err != nil {
		return err
	}

	passwordEnc, err := Encrypt(password)
	if err != nil {
		return err
	}

	// Store in database
	creds := &models.EncryptedCredentials{
		SessionID:   sessionID,
		UsernameEnc: usernameEnc,
		PasswordEnc: passwordEnc,
	}

	return db.DB.Create(creds).Error
}

// GetCredentials retrieves and decrypts session credentials
func (s *CredentialService) GetCredentials(sessionID uuid.UUID) (username, password string, err error) {
	var creds models.EncryptedCredentials
	if err = db.DB.Where("session_id = ?", sessionID).First(&creds).Error; err != nil {
		return "", "", err
	}

	username, err = Decrypt(creds.UsernameEnc)
	if err != nil {
		return "", "", err
	}

	password, err = Decrypt(creds.PasswordEnc)
	if err != nil {
		return "", "", err
	}

	return username, password, nil
}

// UpdateCredentials updates encrypted credentials for a session
func (s *CredentialService) UpdateCredentials(sessionID uuid.UUID, username, password string) error {
	usernameEnc, err := Encrypt(username)
	if err != nil {
		return err
	}

	passwordEnc, err := Encrypt(password)
	if err != nil {
		return err
	}

	return db.DB.Model(&models.EncryptedCredentials{}).
		Where("session_id = ?", sessionID).
		Updates(map[string]interface{}{
			"username_enc": usernameEnc,
			"password_enc": passwordEnc,
		}).Error
}

// DeleteCredentials removes credentials for a session
func (s *CredentialService) DeleteCredentials(sessionID uuid.UUID) error {
	return db.DB.Where("session_id = ?", sessionID).Delete(&models.EncryptedCredentials{}).Error
}

// MigrateExistingCredentials migrates plaintext credentials to encrypted storage
// This is a one-time migration utility
func (s *CredentialService) MigrateExistingCredentials() (migrated int, errors []error) {
	var sessions []models.Session
	if err := db.DB.Where("credentials_user != '' OR credentials_pass != ''").Find(&sessions).Error; err != nil {
		return 0, []error{err}
	}

	for _, session := range sessions {
		// Check if already migrated
		var existing models.EncryptedCredentials
		if err := db.DB.Where("session_id = ?", session.ID).First(&existing).Error; err == nil {
			continue // Already migrated
		}

		// Migrate
		if err := s.StoreCredentials(session.ID, session.CredentialsUser, session.CredentialsPass); err != nil {
			errors = append(errors, err)
			continue
		}

		migrated++
	}

	return migrated, errors
}
