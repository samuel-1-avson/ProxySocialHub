package fx

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func withSource(t *testing.T, h http.HandlerFunc) {
	t.Helper()
	srv := httptest.NewServer(h)
	old := SourceURL
	SourceURL = srv.URL
	resetCache()
	t.Cleanup(func() {
		SourceURL = old
		srv.Close()
		resetCache()
	})
}

func TestOverrideWins(t *testing.T) {
	t.Setenv("FX_USD_GHS_OVERRIDE", "15.5")
	withSource(t, func(w http.ResponseWriter, r *http.Request) {
		t.Error("live source must not be called when override is set")
	})
	got, err := USDToGHS(context.Background())
	if err != nil || got != 15.5 {
		t.Fatalf("got %v %v", got, err)
	}
	t.Setenv("FX_USD_GHS_OVERRIDE", "0.01")
	if _, err := USDToGHS(context.Background()); err == nil {
		t.Fatal("implausible override must be rejected")
	}
}

func TestLiveRateAndCache(t *testing.T) {
	t.Setenv("FX_USD_GHS_OVERRIDE", "")
	calls := 0
	withSource(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		_, _ = w.Write([]byte(`{"result":"success","rates":{"GHS":12.25,"USD":1}}`))
	})
	for i := 0; i < 3; i++ {
		got, err := USDToGHS(context.Background())
		if err != nil || got != 12.25 {
			t.Fatalf("got %v %v", got, err)
		}
	}
	if calls != 1 {
		t.Fatalf("expected 1 live call (cached), got %d", calls)
	}
}

func TestFailsClosedWithoutRate(t *testing.T) {
	t.Setenv("FX_USD_GHS_OVERRIDE", "")
	withSource(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	})
	if _, err := USDToGHS(context.Background()); !errors.Is(err, ErrNoRate) {
		t.Fatalf("want ErrNoRate, got %v", err)
	}
}

func TestImplausibleLiveRateRejected(t *testing.T) {
	t.Setenv("FX_USD_GHS_OVERRIDE", "")
	withSource(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"result":"success","rates":{"GHS":0.0001}}`))
	})
	if _, err := USDToGHS(context.Background()); !errors.Is(err, ErrNoRate) {
		t.Fatalf("want ErrNoRate for implausible rate, got %v", err)
	}
}
