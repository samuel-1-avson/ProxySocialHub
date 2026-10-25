package api

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

// withTestCredentialCipher installs a cipher that, like AES-GCM, uses a random nonce:
// encrypting the same value twice gives different ciphertext, so an equality lookup on
// an encrypted column can never match.
func withTestCredentialCipher(t *testing.T) {
	t.Helper()
	prevEnc, prevDec := models.CredentialEncryptFn, models.CredentialDecryptFn
	models.CredentialEncryptFn = func(plain string) (string, error) {
		nonce := make([]byte, 8)
		if _, err := rand.Read(nonce); err != nil {
			return "", err
		}
		return base64.StdEncoding.EncodeToString(append(nonce, []byte(plain)...)), nil
	}
	models.CredentialDecryptFn = func(cipher string) (string, error) {
		raw, err := base64.StdEncoding.DecodeString(cipher)
		if err != nil {
			return "", err
		}
		if len(raw) < 8 {
			return "", errors.New("ciphertext too short")
		}
		return string(raw[8:]), nil
	}
	t.Cleanup(func() {
		models.CredentialEncryptFn, models.CredentialDecryptFn = prevEnc, prevDec
	})
}

func newCredentialSession(t *testing.T) (models.Session, string, string) {
	t.Helper()
	owner := testutil.CreateTestUser(t, testutil.UniqueEmail("cred-owner"), "buyer")
	user := strings.ReplaceAll(uuid.NewString(), "-", "")[:16]
	pass := strings.ReplaceAll(uuid.NewString(), "-", "")
	s := models.Session{
		UserID:          owner.ID,
		Type:            models.SessionRotating,
		Status:          models.SessionActive,
		CredentialsUser: user,
		CredentialsPass: pass,
		Config:          "{}",
	}
	if err := db.DB.Create(&s).Error; err != nil {
		t.Fatalf("create session: %v", err)
	}
	return s, user, pass
}

func rawCredentialColumns(t *testing.T, id uuid.UUID) (user, pass string) {
	t.Helper()
	if err := db.DB.Raw("SELECT credentials_user, credentials_pass FROM sessions WHERE id = ?", id).
		Row().Scan(&user, &pass); err != nil {
		t.Fatalf("read raw credentials: %v", err)
	}
	return user, pass
}

// BE-CRIT-04: after Create the struct the caller keeps must still hold usable credentials,
// the username must be stored as-is (it is looked up by equality), and the password must be
// encrypted at rest.
func TestSessionCredentials_CreateKeepsPlaintextAndStoresUsernameAsIs(t *testing.T) {
	testutil.SetupTestDB(t)
	withTestCredentialCipher(t)

	s, user, pass := newCredentialSession(t)

	if s.CredentialsUser != user || s.CredentialsPass != pass {
		t.Fatalf("in-memory credentials after Create = %q / %q, want plaintext %q / %q",
			s.CredentialsUser, s.CredentialsPass, user, pass)
	}
	rawUser, rawPass := rawCredentialColumns(t, s.ID)
	if rawUser != user {
		t.Fatalf("stored credentials_user = %q, want the plaintext username %q", rawUser, user)
	}
	if !strings.HasPrefix(rawPass, "ENC:") || strings.Contains(rawPass, pass) {
		t.Fatalf("stored credentials_pass should be encrypted, got %q", rawPass)
	}
}

// terminateSession loads a session, runs Model(&session).Updates(...), and then deletes the
// Redis key named by session.CredentialsUser. A BeforeSave that rewrites the struct to
// ciphertext made that delete target the wrong key and left the credentials live.
func TestSessionCredentials_PartialUpdateDoesNotLeaveCiphertextInStruct(t *testing.T) {
	testutil.SetupTestDB(t)
	withTestCredentialCipher(t)

	created, user, pass := newCredentialSession(t)

	var loaded models.Session
	if err := db.DB.First(&loaded, "id = ?", created.ID).Error; err != nil {
		t.Fatalf("load session: %v", err)
	}
	if loaded.CredentialsUser != user || loaded.CredentialsPass != pass {
		t.Fatalf("loaded credentials = %q / %q, want %q / %q", loaded.CredentialsUser, loaded.CredentialsPass, user, pass)
	}

	if err := db.DB.Model(&loaded).Updates(map[string]interface{}{"status": models.SessionTerminated}).Error; err != nil {
		t.Fatalf("partial update: %v", err)
	}
	if loaded.CredentialsUser != user || loaded.CredentialsPass != pass {
		t.Fatalf("credentials after partial update = %q / %q, want plaintext %q / %q",
			loaded.CredentialsUser, loaded.CredentialsPass, user, pass)
	}
}

// usage.go and the metering spill drain query `WHERE credentials_user = <proxy username>`.
func TestSessionCredentials_LookupByUsernameFindsSession(t *testing.T) {
	testutil.SetupTestDB(t)
	withTestCredentialCipher(t)

	created, user, pass := newCredentialSession(t)

	var found models.Session
	if err := db.DB.Where("credentials_user = ?", user).First(&found).Error; err != nil {
		t.Fatalf("lookup by username: %v", err)
	}
	if found.ID != created.ID || found.CredentialsUser != user || found.CredentialsPass != pass {
		t.Fatalf("lookup returned %s %q / %q, want %s %q / %q",
			found.ID, found.CredentialsUser, found.CredentialsPass, created.ID, user, pass)
	}
}

// getSessionUsage and friends authorize the caller through canAccessSessionUsage, which
// looks the session up by the proxy username.
func TestCanAccessSessionUsage_OwnerFoundByProxyUsername(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.SetupTestRedis(t)
	withTestCredentialCipher(t)

	created, user, _ := newCredentialSession(t)

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	allowed, found := canAccessSessionUsage(c, created.UserID.String(), user)
	if !found || !allowed {
		t.Fatalf("canAccessSessionUsage(owner, %q) = allowed %v found %v, want true true", user, allowed, found)
	}
}

// Rows written before the username became plaintext hold "ENC:<ciphertext>". They must
// still read back correctly and be rewritten as plaintext by the startup migration.
func TestSessionCredentials_LegacyEncryptedUsernameIsMigrated(t *testing.T) {
	testutil.SetupTestDB(t)
	withTestCredentialCipher(t)

	created, user, pass := newCredentialSession(t)

	legacy, err := models.CredentialEncryptFn(user)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.DB.Exec("UPDATE sessions SET credentials_user = ? WHERE id = ?", "ENC:"+legacy, created.ID).Error; err != nil {
		t.Fatalf("seed legacy row: %v", err)
	}

	var loaded models.Session
	if err := db.DB.First(&loaded, "id = ?", created.ID).Error; err != nil {
		t.Fatalf("load legacy row: %v", err)
	}
	if loaded.CredentialsUser != user || loaded.CredentialsPass != pass {
		t.Fatalf("legacy row read back as %q / %q, want %q / %q", loaded.CredentialsUser, loaded.CredentialsPass, user, pass)
	}

	migrated, errs := models.MigrateEncryptedSessionUsernames(db.DB)
	if len(errs) != 0 {
		t.Fatalf("migration errors: %v", errs)
	}
	if migrated < 1 {
		t.Fatalf("expected the legacy row to be migrated, migrated=%d", migrated)
	}
	if rawUser, _ := rawCredentialColumns(t, created.ID); rawUser != user {
		t.Fatalf("stored credentials_user after migration = %q, want %q", rawUser, user)
	}
	var again models.Session
	if err := db.DB.Where("credentials_user = ?", user).First(&again).Error; err != nil {
		t.Fatalf("lookup after migration: %v", err)
	}

	// Idempotent: nothing left to rewrite.
	if n, errs := models.MigrateEncryptedSessionUsernames(db.DB); n != 0 || len(errs) != 0 {
		t.Fatalf("second run migrated %d with errors %v, want 0 and none", n, errs)
	}
}
