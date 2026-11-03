package custody

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/mr-tron/base58"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
	"golang.org/x/oauth2"
)

const fixtureKey = "projects/custody-drill/locations/us-central1/keyRings/embedded/cryptoKeys/wallet-a"

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// Exercises the actual REST encoding/checks against an independently encrypted
// provider boundary. Faults are injected after request integrity verification.
func fakeKMS(t *testing.T, key string) (*GCPKEK, *string) {
	t.Helper()
	g, err := NewGCPKEK(key, "HSM")
	if err != nil {
		t.Fatal(err)
	}
	aead, _ := newGCM(bytes.Repeat([]byte{0x58}, 32))
	fault := ""
	g.token = func(context.Context) (*oauth2.Token, error) {
		if fault == "credentials" {
			return nil, fmt.Errorf("secret-provider-error")
		}
		return &oauth2.Token{AccessToken: "synthetic-access-token"}, nil
	}
	g.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Scheme != "https" || r.URL.Host != "cloudkms.googleapis.com" || !strings.HasPrefix(r.URL.Path, "/v1/"+key+":") || r.Header.Get("Authorization") != "Bearer synthetic-access-token" {
			t.Fatal("unsafe request destination or authentication")
		}
		if fault == "transport" {
			return nil, fmt.Errorf("secret-transport-error")
		}
		if fault == "decrypt-denied" && strings.HasSuffix(r.URL.Path, ":decrypt") {
			return &http.Response{StatusCode: 403, Body: io.NopCloser(strings.NewReader("secret-provider-body"))}, nil
		}
		if fault == "cancel" {
			<-r.Context().Done()
			return nil, r.Context().Err()
		}
		if fault == "forbidden" || fault == "disabled" || fault == "redirect" {
			status := 403
			if fault == "disabled" {
				status = 400
			}
			if fault == "redirect" {
				status = 307
			}
			return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader("secret-provider-body")), Header: http.Header{"Location": []string{"https://attacker.invalid"}}}, nil
		}
		var in struct {
			Plaintext  []byte          `json:"plaintext"`
			Ciphertext []byte          `json:"ciphertext"`
			AAD        []byte          `json:"additionalAuthenticatedData"`
			PlainCRC   json.RawMessage `json:"plaintextCrc32c"`
			CipherCRC  json.RawMessage `json:"ciphertextCrc32c"`
			AADCRC     json.RawMessage `json:"additionalAuthenticatedDataCrc32c"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(in.AAD, g.aad()) || !validCRC(in.AADCRC, in.AAD) {
			t.Fatal("missing AAD integrity")
		}
		out := map[string]any{"protectionLevel": "HSM"}
		if strings.HasSuffix(r.URL.Path, ":encrypt") {
			if !validCRC(in.PlainCRC, in.Plaintext) {
				t.Fatal("missing plaintext integrity")
			}
			ct, err := seal(aead, in.Plaintext, in.AAD)
			if err != nil {
				t.Fatal(err)
			}
			out["name"], out["ciphertext"], out["ciphertextCrc32c"] = key+"/cryptoKeyVersions/1", ct, crcValue(ct)
			out["verifiedPlaintextCrc32c"], out["verifiedAdditionalAuthenticatedDataCrc32c"] = true, true
			if fault == "wrong-resource" {
				out["name"] = fixtureKey + "-other/cryptoKeyVersions/1"
			}
			if fault == "version-only" {
				out["name"] = "1"
			}
			if fault == "unverified" {
				out["verifiedPlaintextCrc32c"] = false
			}
			if fault == "unverified-aad" {
				out["verifiedAdditionalAuthenticatedDataCrc32c"] = false
			}
			if fault == "corrupt" {
				out["ciphertextCrc32c"] = "-1"
			}
			if fault == "missing-crc" {
				delete(out, "ciphertextCrc32c")
			}
		} else {
			if !validCRC(in.CipherCRC, in.Ciphertext) {
				t.Fatal("missing ciphertext integrity")
			}
			plain, err := open(aead, in.Ciphertext, in.AAD)
			if err != nil {
				return &http.Response{StatusCode: 400, Body: io.NopCloser(strings.NewReader("bad ciphertext"))}, nil
			}
			out["plaintext"], out["plaintextCrc32c"] = plain, crcValue(plain)
			if fault == "corrupt" {
				out["plaintextCrc32c"] = "4294967296"
			}
			if fault == "missing-crc" {
				delete(out, "plaintextCrc32c")
			}
			if fault == "wrong-length" {
				out["plaintext"] = []byte("short")
				out["plaintextCrc32c"] = crcValue([]byte("short"))
			}
		}
		if fault == "wrong-level" {
			out["protectionLevel"] = "SOFTWARE"
		}
		body, _ := json.Marshal(out)
		if fault == "malformed" {
			body = []byte("{invalid")
		}
		if fault == "oversize" {
			body = bytes.Repeat([]byte("x"), maxKMSBody+1)
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(body))}, nil
	})
	return g, &fault
}

func TestGCPKMSRejectsUnsafeConfiguration(t *testing.T) {
	for _, name := range []string{"", "https://cloudkms.googleapis.com/" + fixtureKey, fixtureKey + "/cryptoKeyVersions/1", fixtureKey + "?alt=json", strings.Replace(fixtureKey, "wallet-a", "..", 1), fixtureKey + "#x"} {
		if _, err := NewGCPKEK(name, "HSM"); err == nil {
			t.Fatalf("accepted unsafe key resource %q", name)
		}
	}
	if _, err := NewGCPKEK(fixtureKey, "EXTERNAL"); err == nil {
		t.Fatal("accepted unexpected protection level")
	}
	t.Setenv("EMBEDDED_WALLET_KEK_PROVIDER", "gcp-kms")
	t.Setenv("EMBEDDED_WALLET_GCP_KMS_KEY", fixtureKey)
	t.Setenv("EMBEDDED_WALLET_GCP_KMS_READ_KEYS", "")
	t.Setenv("EMBEDDED_WALLET_KMS_PROTECTION_LEVEL", "HSM")
	t.Setenv("APP_ENV", "production")
	k, err := DefaultKEK()
	if err != nil || k.ID() != "gcp-kms:v1:"+fixtureKey {
		t.Fatal(k, err)
	}
	t.Setenv("EMBEDDED_WALLET_GCP_KMS_KEY", "")
	t.Setenv("EMBEDDED_WALLET_KEK", strings.Repeat("00", 32))
	if _, err := DefaultKEK(); err == nil {
		t.Fatal("remote misconfiguration fell back to local")
	}
	t.Setenv("EMBEDDED_WALLET_KEK_PROVIDER", "typo")
	if _, err := DefaultKEK(); err == nil {
		t.Fatal("unknown provider accepted")
	}
}

func TestGCPKMSIntegrityOutagesAndRecovery(t *testing.T) {
	g, fault := fakeKMS(t, fixtureKey)
	plain := bytes.Repeat([]byte{0x73}, 32)
	wrapped, err := g.Wrap(plain)
	if err != nil {
		t.Fatal(err)
	}
	got, err := g.Unwrap(wrapped)
	if err != nil || !bytes.Equal(got, plain) {
		t.Fatal("roundtrip", err)
	}
	for _, f := range []string{"credentials", "transport", "forbidden", "disabled", "redirect", "wrong-resource", "version-only", "unverified", "unverified-aad", "corrupt", "missing-crc", "wrong-level", "malformed", "oversize"} {
		t.Run("encrypt_"+f, func(t *testing.T) {
			*fault = f
			if b, err := g.Wrap(plain); err == nil || b != nil || !errors.Is(err, ErrKEKUnavailable) || strings.Contains(err.Error(), "secret-") {
				t.Fatalf("unsafe failure: %v %v", b, err)
			}
		})
	}
	for _, f := range []string{"credentials", "transport", "forbidden", "disabled", "redirect", "corrupt", "missing-crc", "wrong-level", "wrong-length", "malformed", "oversize"} {
		t.Run("decrypt_"+f, func(t *testing.T) {
			*fault = f
			if b, err := g.Unwrap(wrapped); err == nil || b != nil || !errors.Is(err, ErrKEKUnavailable) || strings.Contains(err.Error(), "secret-") {
				t.Fatalf("unsafe failure: %v %v", b, err)
			}
		})
	}
	*fault = ""
	wrapped[0] ^= 1
	if _, err := g.Unwrap(wrapped); err == nil {
		t.Fatal("tampered data recovered")
	}
	if _, err := g.Wrap(plain[:31]); err == nil {
		t.Fatal("wrong DEK length accepted")
	}
	if _, err := g.Unwrap(make([]byte, 8193)); err == nil {
		t.Fatal("oversize ciphertext accepted")
	}
	if err := Probe(context.Background(), g); err != nil {
		t.Fatal("did not recover after outage", err)
	}
	*fault = "cancel"
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	start := time.Now()
	if _, err := g.WrapContext(ctx, plain); err == nil || time.Since(start) > time.Second {
		t.Fatal("cancellation did not stop provider call")
	}
}

func TestGCPKMSCRCRejectsInvalidValues(t *testing.T) {
	b := []byte("123456789")
	for _, raw := range []string{`"3808858755"`, `3808858755`} {
		if !validCRC(json.RawMessage(raw), b) {
			t.Fatal("valid CRC rejected")
		}
	}
	for _, raw := range []string{`null`, `"-1"`, `4294967296`, `3.808858755e9`, `""`, `false`} {
		if validCRC(json.RawMessage(raw), b) {
			t.Fatal("invalid CRC accepted", raw)
		}
	}
}

func exerciseCustodyRotation(t *testing.T, source, target KEK, outage func(bool)) {
	t.Helper()
	testutil.SetupTestDB(t)
	u := testutil.CreateTestUser(t, testutil.UniqueEmail("kms-rotation"), "buyer")
	row, err := CreateSolanaWallet(db.DB, source, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.DB.Where("id = ?", row.ID).Delete(&models.EmbeddedWallet{}) })
	ring, err := NewKeyRing(target, source)
	if err != nil {
		t.Fatal(err)
	}
	sign := func(k KEK) {
		t.Helper()
		s, err := NewSigner(db.DB, k, u.ID)
		if err != nil {
			t.Fatal(err)
		}
		msg := []byte("synthetic staging custody drill; no transaction or funds")
		sig, err := s.Sign(msg)
		if err != nil {
			t.Fatal(err)
		}
		pub, _ := base58.Decode(row.Address)
		if !ed25519.Verify(pub, msg, sig) {
			t.Fatal("signature invalid")
		}
	}
	sign(ring)
	if _, err := NewSigner(db.DB, target, u.ID); !errors.Is(err, ErrUnknownKEK) {
		t.Fatal("unlisted reader accepted", err)
	}
	dry, err := RewrapBatch(context.Background(), db.DB, ring, source.ID(), uuid.Nil, 1, false)
	if err != nil || dry.Checked != 1 || dry.Updated != 0 {
		t.Fatal("dry run", dry, err)
	}
	var unchanged models.EmbeddedWallet
	db.DB.First(&unchanged, "id = ?", row.ID)
	if unchanged.KEKID != row.KEKID || !bytes.Equal(unchanged.WrappedDEK, row.WrappedDEK) {
		t.Fatal("dry run mutated row")
	}
	if outage != nil {
		outage(true)
		if _, err := RewrapBatch(context.Background(), db.DB, ring, source.ID(), uuid.Nil, 1, true); err == nil {
			t.Fatal("outage did not stop migration")
		}
		db.DB.First(&unchanged, "id = ?", row.ID)
		if unchanged.KEKID != row.KEKID || !bytes.Equal(unchanged.WrappedDEK, row.WrappedDEK) {
			t.Fatal("failed migration changed source")
		}
		outage(false)
	}
	applied, err := RewrapBatch(context.Background(), db.DB, ring, source.ID(), uuid.Nil, 1, true)
	if err != nil || applied.Updated != 1 {
		t.Fatal("apply", applied, err)
	}
	var rotated models.EmbeddedWallet
	db.DB.First(&rotated, "id = ?", row.ID)
	if rotated.Address != row.Address || !bytes.Equal(rotated.SealedKey, row.SealedKey) || bytes.Equal(rotated.WrappedDEK, row.WrappedDEK) || rotated.KEKID != target.ID() {
		t.Fatal("rotation changed signing identity or failed")
	}
	sign(target)
	// A same-CryptoKey primary-version rewrap is also bounded/resumable.
	batch, err := RewrapBatch(context.Background(), db.DB, target, target.ID(), uuid.Nil, 1, true)
	if err != nil || batch.Updated != 1 {
		t.Fatal("same key rewrap", batch, err)
	}
	cursor, _ := uuid.Parse(batch.NextCursor)
	if result, err := RewrapBatch(context.Background(), db.DB, target, target.ID(), cursor, 1, true); err != nil || result.Checked != 0 {
		t.Fatal("resume cursor repeated a row", result, err)
	}
	sign(target)
	// A restored pre-migration backup remains usable with the retained source key.
	if err := db.DB.Model(&models.EmbeddedWallet{}).Where("id = ?", row.ID).Updates(map[string]any{"wrapped_dek": row.WrappedDEK, "kek_id": row.KEKID}).Error; err != nil {
		t.Fatal(err)
	}
	sign(ring)
}

func TestStagingCustodyRotationAndBackupRecovery(t *testing.T) {
	a, _ := fakeKMS(t, fixtureKey)
	b, fault := fakeKMS(t, strings.TrimSuffix(fixtureKey, "a")+"b")
	exerciseCustodyRotation(t, a, b, func(down bool) {
		*fault = ""
		if down {
			*fault = "forbidden"
		}
	})
}

func TestStagingCustodyLegacyMigration(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "embedded_wallets")
	target, _ := fakeKMS(t, fixtureKey+"-migration")
	exerciseCustodyRotation(t, randomKEK(t), target, nil)
}

func TestStagingCustodyCreationRequiresRecoverableKey(t *testing.T) {
	testutil.SetupTestDB(t)
	user := testutil.CreateTestUser(t, testutil.UniqueEmail("kms-no-decrypt"), "buyer")
	key, fault := fakeKMS(t, fixtureKey+"-unrecoverable")
	*fault = "decrypt-denied"
	if _, err := CreateSolanaWallet(db.DB, key, user.ID); !errors.Is(err, ErrKEKUnavailable) {
		t.Fatal("unrecoverable wallet accepted", err)
	}
	var count int64
	if err := db.DB.Model(&models.EmbeddedWallet{}).Where("user_id = ?", user.ID).Count(&count).Error; err != nil || count != 0 {
		t.Fatal("unrecoverable wallet persisted", err)
	}
}

// State changes are opt-in and restricted to version 1 in the dedicated staging
// ring. The application identity must not be permitted to administer its keys.
func liveKMSState(t *testing.T, key, version, state, token string) int {
	t.Helper()
	if !cryptoKeyName.MatchString(key) || !strings.Contains(key, "/keyRings/proxyhubb-embedded-staging/") || !keyVersionNumber.MatchString(version) || (state != "ENABLED" && state != "DISABLED") {
		t.Fatal("unsafe live drill key control")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	body, _ := json.Marshal(map[string]string{"state": state})
	req, err := http.NewRequestWithContext(ctx, http.MethodPatch, "https://cloudkms.googleapis.com/v1/"+key+"/cryptoKeyVersions/"+version+"?updateMask=state", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	client := &http.Client{Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(req)
	if err != nil {
		t.Fatal("staging key control request failed")
	}
	defer response.Body.Close()
	io.Copy(io.Discard, io.LimitReader(response.Body, 16*1024))
	return response.StatusCode
}

func liveKMSMetadata(t *testing.T, key, suffix, method, token string, payload any) map[string]any {
	t.Helper()
	if !cryptoKeyName.MatchString(key) || !strings.Contains(key, "/keyRings/proxyhubb-embedded-staging/") {
		t.Fatal("unsafe live drill metadata target")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	var input io.Reader
	if payload != nil {
		body, _ := json.Marshal(payload)
		input = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, "https://cloudkms.googleapis.com/v1/"+key+suffix, input)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	client := &http.Client{Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(req)
	if err != nil {
		t.Fatal("staging KMS metadata request failed")
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatalf("staging KMS metadata HTTP %d", response.StatusCode)
	}
	var out map[string]any
	if json.NewDecoder(io.LimitReader(response.Body, 16*1024)).Decode(&out) != nil {
		t.Fatal("invalid staging KMS metadata")
	}
	return out
}

func waitLiveKMS(t *testing.T, key *GCPKEK, available bool) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	start := time.Now()
	for {
		err := Probe(ctx, key)
		if (available && err == nil) || (!available && err != nil && (strings.Contains(err.Error(), "KMS HTTP 400") || strings.Contains(err.Error(), "KMS HTTP 403"))) {
			t.Logf("provider crypto availability=%v observed after %s", available, time.Since(start).Round(time.Millisecond))
			if err != nil {
				t.Logf("provider refusal: %v", err)
			}
			return
		}
		if err != nil {
			t.Logf("waiting for provider state, crypto result: %v", err)
		}
		select {
		case <-ctx.Done():
			t.Fatal("staging key state did not propagate within the drill deadline")
		case <-time.After(time.Second):
		}
	}
}

// Emergency denial removes the exact staging runtime binding as well as
// disabling the version. Key-state propagation alone is not an immediate kill
// switch. ETags protect unrelated concurrent policy edits.
func liveKMSRuntimeAccess(t *testing.T, key, token string, allow bool) {
	t.Helper()
	policy := liveKMSMetadata(t, key, ":getIamPolicy", http.MethodGet, token, nil)
	project := strings.Split(key, "/")[1]
	member := "serviceAccount:proxyhubb-custody-staging@" + project + ".iam.gserviceaccount.com"
	bindings, _ := policy["bindings"].([]any)
	found := false
	for _, raw := range bindings {
		binding, ok := raw.(map[string]any)
		if !ok {
			t.Fatal("invalid staging IAM binding")
		}
		if binding["role"] != "roles/cloudkms.cryptoKeyEncrypterDecrypter" {
			continue
		}
		if _, conditional := binding["condition"]; conditional {
			t.Fatal("unexpected conditional staging IAM binding")
		}
		found = true
		members, _ := binding["members"].([]any)
		kept := make([]any, 0, len(members)+1)
		for _, m := range members {
			if m != member {
				kept = append(kept, m)
			}
		}
		if allow {
			kept = append(kept, member)
		}
		binding["members"] = kept
	}
	if !found && allow {
		bindings = append(bindings, map[string]any{"role": "roles/cloudkms.cryptoKeyEncrypterDecrypter", "members": []string{member}})
	}
	var nonempty []any
	for _, raw := range bindings {
		binding := raw.(map[string]any)
		switch members := binding["members"].(type) {
		case []any:
			if len(members) == 0 {
				continue
			}
		case []string:
			if len(members) == 0 {
				continue
			}
		}
		nonempty = append(nonempty, binding)
	}
	if nonempty == nil {
		nonempty = []any{}
	}
	policy["bindings"] = nonempty
	liveKMSMetadata(t, key, ":setIamPolicy", http.MethodPost, token, map[string]any{"policy": policy})
}

func TestStagingCustodyLiveKMS(t *testing.T) {
	keyA, keyB := os.Getenv("CUSTODY_DRILL_KMS_KEY_A"), os.Getenv("CUSTODY_DRILL_KMS_KEY_B")
	if keyA == "" || keyB == "" {
		t.Skip("dedicated staging Cloud KMS resources not selected")
	}
	// Explicitly reject the existing treasury/oracle key rings and production keys.
	for _, key := range []string{keyA, keyB} {
		if !strings.Contains(key, "/keyRings/proxyhubb-embedded-staging/") {
			t.Fatal("live drill requires the dedicated staging key ring")
		}
	}
	a, err := NewGCPKEK(keyA, "HSM")
	if err != nil {
		t.Fatal(err)
	}
	b, err := NewGCPKEK(keyB, "HSM")
	if err != nil {
		t.Fatal(err)
	}
	// Optional short-lived gcloud credential stays in this test process only.
	runtimeToken := os.Getenv("CUSTODY_DRILL_ACCESS_TOKEN")
	if token := runtimeToken; token != "" {
		os.Unsetenv("CUSTODY_DRILL_ACCESS_TOKEN")
		for _, g := range []*GCPKEK{a, b} {
			g.token = func(context.Context) (*oauth2.Token, error) { return &oauth2.Token{AccessToken: token}, nil }
		}
	}
	if err := Probe(context.Background(), a); err != nil {
		t.Fatal("live source probe", err)
	}
	if err := Probe(context.Background(), b); err != nil {
		t.Fatal("live target probe", err)
	}
	var outage func(bool)
	if controlToken := os.Getenv("CUSTODY_DRILL_CONTROL_TOKEN"); controlToken != "" {
		os.Unsetenv("CUSTODY_DRILL_CONTROL_TOKEN")
		if runtimeToken == "" {
			t.Fatal("separate runtime credential is required")
		}
		// Always restore the test key even if a subsequent assertion fails.
		metadata := liveKMSMetadata(t, keyB, "", http.MethodGet, controlToken, nil)
		primary, ok := metadata["primary"].(map[string]any)
		if !ok {
			t.Fatal("staging key has no primary")
		}
		name, _ := primary["name"].(string)
		version := strings.TrimPrefix(name, keyB+"/cryptoKeyVersions/")
		if !keyVersionNumber.MatchString(version) {
			t.Fatal("invalid primary version")
		}
		t.Cleanup(func() {
			if status := liveKMSState(t, keyB, version, "ENABLED", controlToken); status != 200 {
				t.Errorf("restore staging key: HTTP %d", status)
			}
			liveKMSRuntimeAccess(t, keyB, controlToken, true)
		})
		if status := liveKMSState(t, keyB, version, "DISABLED", runtimeToken); status != 403 {
			t.Fatalf("runtime can administer keys or returned unexpected status: %d", status)
		}
		t.Log("restricted runtime identity denied key administration (HTTP 403)")
		outage = func(down bool) {
			state := "ENABLED"
			if down {
				state = "DISABLED"
			}
			if status := liveKMSState(t, keyB, version, state, controlToken); status != 200 {
				t.Fatalf("staging key state update: HTTP %d", status)
			}
			liveKMSRuntimeAccess(t, keyB, controlToken, !down)
			waitLiveKMS(t, b, !down)
			if down {
				t.Log("staging target key disabled and runtime IAM revoked for actual denial check")
			} else {
				t.Log("staging target key restored for recovery check")
			}
		}
		// Primary-version rotation must continue recovering older ciphertext under
		// the same stored CryptoKey ID. Only synthetic data is used here.
		t.Cleanup(func() {
			if t.Failed() {
				return
			}
			dek := bytes.Repeat([]byte{0x38}, 32)
			defer zero(dek)
			old, err := b.Wrap(dek)
			if err != nil {
				t.Fatal(err)
			}
			created := liveKMSMetadata(t, keyB, "/cryptoKeyVersions", http.MethodPost, controlToken, map[string]string{"state": "ENABLED"})
			name, _ := created["name"].(string)
			v := strings.TrimPrefix(name, keyB+"/cryptoKeyVersions/")
			if !keyVersionNumber.MatchString(v) {
				t.Fatal("invalid new key version")
			}
			deadline := time.Now().Add(45 * time.Second)
			for created["state"] != "ENABLED" {
				if time.Now().After(deadline) {
					t.Fatal("new KMS version did not become enabled")
				}
				time.Sleep(time.Second)
				created = liveKMSMetadata(t, keyB, "/cryptoKeyVersions/"+v, http.MethodGet, controlToken, nil)
			}
			liveKMSMetadata(t, keyB, ":updatePrimaryVersion", http.MethodPost, controlToken, map[string]string{"cryptoKeyVersionId": v})
			if got, err := b.Unwrap(old); err != nil || !bytes.Equal(got, dek) {
				zero(got)
				t.Fatal("old ciphertext unreadable after primary rotation", err)
			} else {
				zero(got)
			}
			if err := Probe(context.Background(), b); err != nil {
				t.Fatal("new primary cannot wrap and recover", err)
			}
			t.Log("actual Cloud KMS primary-version rotation preserved old ciphertext recovery")
		})
	}
	exerciseCustodyRotation(t, a, b, outage)
}
