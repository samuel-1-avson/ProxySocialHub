package logging

import (
	"bytes"
	"errors"
	stdlog "log"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog/log"
)

// Not a real key: the tests only need something with the shape of one.
const fakeKey = "0f1e2d3c-fake-key-0000"

func TestRedactMasksQuerySecrets(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{
			name: "the Solana client's RPC error, as the control API logged it",
			in:   "rpc call sendTransaction() on https://devnet.helius-rpc.com/?api-key=" + fakeKey + " status code: 429. could not decode body",
			want: "rpc call sendTransaction() on https://devnet.helius-rpc.com/?api-key=[redacted] status code: 429. could not decode body",
		},
		{
			name: "followed by a colon",
			in:   "dial https://rpc.example/?api-key=" + fakeKey + ": connection refused",
			want: "dial https://rpc.example/?api-key=[redacted]: connection refused",
		},
		{
			name: "underscore spelling",
			in:   "GET https://x.example/v1?api_key=" + fakeKey,
			want: "GET https://x.example/v1?api_key=[redacted]",
		},
		{
			name: "apikey spelling",
			in:   "GET https://x.example/v1?apikey=" + fakeKey,
			want: "GET https://x.example/v1?apikey=[redacted]",
		},
		{
			name: "header-style name in any case",
			in:   "https://x.example/?X-API-Key=" + fakeKey,
			want: "https://x.example/?X-API-Key=[redacted]",
		},
		{
			name: "second parameter, with more after it",
			in:   "https://x.example/?network=devnet&token=" + fakeKey + "&limit=5",
			want: "https://x.example/?network=devnet&token=[redacted]&limit=5",
		},
		{
			name: "access token",
			in:   "https://x.example/cb?access_token=" + fakeKey + "&state=abc",
			want: "https://x.example/cb?access_token=[redacted]&state=abc",
		},
		{
			name: "inside a JSON string",
			in:   `{"error":"rpc call on https://rpc.example/?api-key=` + fakeKey + `"}`,
			want: `{"error":"rpc call on https://rpc.example/?api-key=[redacted]"}`,
		},
		{
			name: "inside an escaped JSON string",
			in:   `{"msg":"{\"url\":\"https://rpc.example/?api-key=` + fakeKey + `\"}"}`,
			want: `{"msg":"{\"url\":\"https://rpc.example/?api-key=[redacted]\"}"}`,
		},
		{
			name: "two secrets in one line",
			in:   "a https://one.example/?api-key=AAAA1111 b https://two.example/?token=BBBB2222 c",
			want: "a https://one.example/?api-key=[redacted] b https://two.example/?token=[redacted] c",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := string(Redact([]byte(tc.in)))
			if got != tc.want {
				t.Fatalf("\n got: %s\nwant: %s", got, tc.want)
			}
			if strings.Contains(got, fakeKey) {
				t.Fatalf("the key is still in the output: %s", got)
			}
		})
	}
}

func TestRedactMasksCredentialsInURLs(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{
			in:   "connect postgres://app:hunter2@db:5432/proxyhubb failed",
			want: "connect postgres://[redacted]@db:5432/proxyhubb failed",
		},
		{
			in:   "redis://:pa55word@cache:6379 refused",
			want: "redis://[redacted]@cache:6379 refused",
		},
	}
	for _, tc := range cases {
		if got := string(Redact([]byte(tc.in))); got != tc.want {
			t.Fatalf("\n got: %s\nwant: %s", got, tc.want)
		}
	}
}

func TestRedactMasksBearerTokens(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{
			in:   "upstream said Authorization: Bearer eyJhbGciOi.abc-DEF_123= rejected",
			want: "upstream said Authorization: Bearer [redacted] rejected",
		},
		{
			in:   "header authorization=bearer 0123456789abcdef",
			want: "header authorization=bearer [redacted]",
		},
	}
	for _, tc := range cases {
		if got := string(Redact([]byte(tc.in))); got != tc.want {
			t.Fatalf("\n got: %s\nwant: %s", got, tc.want)
		}
	}
}

// Masking must not change lines that hold no secret: these are the shapes the control API logs
// all day, plus the near misses each pattern could trip on.
func TestRedactLeavesOrdinaryLinesAlone(t *testing.T) {
	lines := []string{
		"request body_size=35 latency=3.7 method=POST path=/v1/provider/lease request_id= status=401",
		"GET /v1/listings?country=GH&page=2&sort=asc 200",
		"token_id=3f2a user_id=9c1b key=value",
		"contact ops@example.com about the invoice",
		"profile link https://example.com/profile/@alice",
		"listening on https://example.com:8443/path",
		"the bearer of this note is not a credential",
		"Authorization header required",
		"sig=ok in the middle of a sentence, not a query string",
	}
	for _, line := range lines {
		if got := string(Redact([]byte(line))); got != line {
			t.Fatalf("an ordinary line was changed:\n  in:  %s\n  out: %s", line, got)
		}
	}
}

func TestRedactReturnsTheSameSliceWhenThereIsNothingToMask(t *testing.T) {
	in := []byte("request method=GET path=/health status=200")
	out := Redact(in)
	if &out[0] != &in[0] {
		t.Fatal("a line with no marker bytes was copied")
	}
}

func TestRedactingWriter(t *testing.T) {
	var buf bytes.Buffer
	w := NewRedactingWriter(&buf)

	// A line from the standard logger, as the Solana workers write it.
	l := stdlog.New(w, "", 0)
	l.Printf("[TelemetryWorker] Failed to anchor usage on-chain: rpc call sendTransaction() on https://devnet.helius-rpc.com/?api-key=%s status code: 429", fakeKey)
	got := buf.String()
	if strings.Contains(got, fakeKey) {
		t.Fatalf("the key reached the destination: %s", got)
	}
	if !strings.Contains(got, "api-key=[redacted] status code: 429") {
		t.Fatalf("the rest of the message was lost: %s", got)
	}

	// Write must report the length it was given, not the length it wrote.
	line := []byte("https://x.example/?api-key=" + fakeKey + "\n")
	n, err := NewRedactingWriter(&bytes.Buffer{}).Write(line)
	if err != nil || n != len(line) {
		t.Fatalf("Write returned (%d, %v), want (%d, nil)", n, err, len(line))
	}
}

type failingWriter struct{}

func (failingWriter) Write([]byte) (int, error) { return 0, errors.New("disk full") }

func TestRedactingWriterPassesErrorsOn(t *testing.T) {
	n, err := NewRedactingWriter(failingWriter{}).Write([]byte("anything"))
	if err == nil || n != 0 {
		t.Fatalf("Write returned (%d, %v), want (0, an error)", n, err)
	}
}

// The structured logger, in both of its output modes, goes through the mask.
func TestInitMasksZerologOutput(t *testing.T) {
	for _, env := range []string{"", "production"} {
		t.Run("ENV="+env, func(t *testing.T) {
			t.Setenv("ENV", env)
			prevLogger, prevGlobal := Logger, log.Logger
			t.Cleanup(func() { Logger, log.Logger = prevLogger, prevGlobal })

			var buf bytes.Buffer
			initTo(&buf)
			Warn().
				Err(errors.New("rpc call sendTransaction() on https://devnet.helius-rpc.com/?api-key=" + fakeKey + " status code: 429")).
				Msg("on-chain heartbeat failed (non-fatal)")

			out := buf.String()
			if strings.Contains(out, fakeKey) {
				t.Fatalf("the key reached the log: %s", out)
			}
			if !strings.Contains(out, "api-key=[redacted]") || !strings.Contains(out, "status code: 429") {
				t.Fatalf("the error text was lost: %s", out)
			}
		})
	}
}

// The standard logger and gin write from process start, before Init runs, so they are wired in
// the package's init.
func TestProcessWideWritersAreMasked(t *testing.T) {
	if _, ok := stdlog.Writer().(redactingWriter); !ok {
		t.Fatalf("the standard logger writes unmasked: %T", stdlog.Writer())
	}
	if _, ok := gin.DefaultWriter.(redactingWriter); !ok {
		t.Fatalf("gin.DefaultWriter writes unmasked: %T", gin.DefaultWriter)
	}
	if _, ok := gin.DefaultErrorWriter.(redactingWriter); !ok {
		t.Fatalf("gin.DefaultErrorWriter writes unmasked: %T", gin.DefaultErrorWriter)
	}
}
