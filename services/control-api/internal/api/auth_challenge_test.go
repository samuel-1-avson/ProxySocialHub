package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func storeChallenge(t *testing.T, addr, msg string, inRedis, inMemory bool, memExpires time.Time) {
	t.Helper()
	if inRedis {
		if err := redisClient.Client.Set(context.Background(), "auth:nonce:"+addr, msg, time.Minute).Err(); err != nil {
			t.Fatalf("redis set: %v", err)
		}
	}
	if inMemory {
		memStoreMutex.Lock()
		memStore[addr] = memStoreEntry{value: msg, expiresAt: memExpires}
		memStoreMutex.Unlock()
	}
	t.Cleanup(func() {
		memStoreMutex.Lock()
		delete(memStore, addr)
		memStoreMutex.Unlock()
	})
}

// BE-HIGH-03: getAuthChallenge stores the challenge in Redis and in memory. walletLogin used
// to delete only the Redis copy when it found one, so the in-memory copy let the same signed
// challenge log in a second time within the TTL.
func TestConsumeLoginChallenge_IsSingleUseAcrossBothStores(t *testing.T) {
	testutil.SetupTestRedis(t)
	addr := "wallet-" + uuid.NewString()
	storeChallenge(t, addr, "Sign this message to login to ProxyHubb: abc", true, true, time.Now().Add(time.Minute))

	got, ok := consumeLoginChallenge(context.Background(), addr)
	if !ok || got != "Sign this message to login to ProxyHubb: abc" {
		t.Fatalf("first consume = %q, %v; want the stored challenge", got, ok)
	}
	if got, ok := consumeLoginChallenge(context.Background(), addr); ok {
		t.Fatalf("the same challenge was accepted twice (second consume returned %q)", got)
	}
}

func TestConsumeLoginChallenge_InMemoryFallbackAndExpiry(t *testing.T) {
	testutil.SetupTestRedis(t)

	live := "wallet-" + uuid.NewString()
	storeChallenge(t, live, "live", false, true, time.Now().Add(time.Minute))
	if got, ok := consumeLoginChallenge(context.Background(), live); !ok || got != "live" {
		t.Fatalf("memory-only challenge = %q, %v; want it accepted once", got, ok)
	}
	if _, ok := consumeLoginChallenge(context.Background(), live); ok {
		t.Fatal("memory-only challenge accepted twice")
	}

	expired := "wallet-" + uuid.NewString()
	storeChallenge(t, expired, "stale", false, true, time.Now().Add(-time.Second))
	if _, ok := consumeLoginChallenge(context.Background(), expired); ok {
		t.Fatal("an expired challenge was accepted")
	}

	if _, ok := consumeLoginChallenge(context.Background(), "wallet-"+uuid.NewString()); ok {
		t.Fatal("an address with no challenge was accepted")
	}
}

// Entries used to leave memStore only when their own address logged in, so challenges that
// were requested and never signed accumulated without bound.
func TestGetAuthChallenge_PurgesExpiredInMemoryChallengesAtTheCap(t *testing.T) {
	testutil.SetupTestRedis(t)

	memStoreMutex.Lock()
	saved := memStore
	memStore = make(map[string]memStoreEntry, memStoreMaxEntries)
	for i := 0; i < memStoreMaxEntries; i++ {
		memStore[uuid.NewString()] = memStoreEntry{value: "old", expiresAt: time.Now().Add(-time.Minute)}
	}
	memStoreMutex.Unlock()
	t.Cleanup(func() {
		memStoreMutex.Lock()
		memStore = saved
		memStoreMutex.Unlock()
	})

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/challenge", getAuthChallenge)
	body := strings.NewReader(`{"address":"` + uuid.NewString() + `"}`)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/challenge", body))
	if w.Code != http.StatusOK {
		t.Fatalf("challenge: %d %s", w.Code, w.Body.String())
	}

	memStoreMutex.RLock()
	n := len(memStore)
	memStoreMutex.RUnlock()
	if n != 1 {
		t.Fatalf("memStore holds %d entries after the purge, want only the new challenge", n)
	}
}

func TestConsumeLoginChallenge_ConcurrentLoginsOnlyOneWins(t *testing.T) {
	testutil.SetupTestRedis(t)
	addr := "wallet-" + uuid.NewString()
	storeChallenge(t, addr, "race", true, true, time.Now().Add(time.Minute))

	var wins atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, ok := consumeLoginChallenge(context.Background(), addr); ok {
				wins.Add(1)
			}
		}()
	}
	wg.Wait()
	if n := wins.Load(); n != 1 {
		t.Fatalf("%d concurrent logins consumed one challenge, want exactly 1", n)
	}
}
