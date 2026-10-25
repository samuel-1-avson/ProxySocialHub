package worker

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/redis"
	"github.com/proxyhubb/control-api/internal/testutil"
)

// Random-nonce cipher, like AES-GCM: ciphertext differs on every call.
func withReaperTestCipher(t *testing.T) {
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
		if err != nil || len(raw) < 8 {
			return "", errors.New("bad ciphertext")
		}
		return string(raw[8:]), nil
	}
	t.Cleanup(func() { models.CredentialEncryptFn, models.CredentialDecryptFn = prevEnc, prevDec })
}

// newReaperSession returns the stored session and the plaintext proxy username it was
// created with. Tests use the returned username, not the struct field, so they do not
// depend on what Create leaves in the struct.
func newReaperSession(t *testing.T) (models.Session, string) {
	t.Helper()
	owner := testutil.CreateTestUser(t, testutil.UniqueEmail("reaper"), "buyer")
	user := strings.ReplaceAll(uuid.NewString(), "-", "")[:16]
	s := models.Session{
		UserID:          owner.ID,
		Type:            models.SessionRotating,
		Status:          models.SessionActive,
		CredentialsUser: user,
		CredentialsPass: strings.ReplaceAll(uuid.NewString(), "-", ""),
		Config:          "{}",
	}
	if err := db.DB.Create(&s).Error; err != nil {
		t.Fatalf("create session: %v", err)
	}
	return s, user
}

func statusOf(t *testing.T, id uuid.UUID) models.SessionStatus {
	t.Helper()
	var s models.Session
	if err := db.DB.First(&s, "id = ?", id).Error; err != nil {
		t.Fatalf("reload session: %v", err)
	}
	return s.Status
}

// BE-CRIT-04 claimed SessionReaper terminates every active session every five minutes
// because it looks up Redis with the encrypted username. With the credential hooks wired
// it must leave a session alone when its Redis key exists, and still reap a real ghost.
func TestReap_KeepsSessionsWithLiveRedisKeyAndReapsGhosts(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.SetupTestRedis(t)
	withReaperTestCipher(t)

	live, liveUser := newReaperSession(t)
	ghost, _ := newReaperSession(t)

	if err := redis.StoreSession(liveUser, &redis.SessionData{
		UserID: live.UserID.String(), SessionID: live.ID.String(), Status: "active",
	}, time.Hour); err != nil {
		t.Fatalf("store redis session: %v", err)
	}

	reap()

	if got := statusOf(t, live.ID); got != models.SessionActive {
		t.Errorf("session with a live Redis key was reaped: status = %q, want active", got)
	}
	if got := statusOf(t, ghost.ID); got != models.SessionTerminated {
		t.Errorf("ghost session (no Redis key, no order) status = %q, want terminated", got)
	}
}
