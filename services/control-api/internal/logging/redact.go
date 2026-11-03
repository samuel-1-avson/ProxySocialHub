package logging

import (
	"bytes"
	"io"
	stdlog "log"
	"os"
	"regexp"

	"github.com/gin-gonic/gin"
)

// Secrets reach log lines through error text, not through fields anyone chose to log. The
// Solana RPC client, for one, builds its errors as "rpc call sendTransaction() on
// https://host/?api-key=KEY ...", so every failed RPC call printed the provider key. The call
// sites are many (zerolog events and plain log.Printf in the workers), so the masking is done
// where all output passes: a writer wrapped around each log destination.

const redactedMark = "[redacted]"

var (
	// A secret in a URL query string: ?api-key=..., &token=..., ?X-API-Key=...
	// The value stops at whitespace, the next parameter, a quote, a colon or a closing bracket,
	// so the rest of the message survives ("...?api-key=[redacted]: connection refused").
	querySecretRE = regexp.MustCompile(`(?i)([?&](?:x-)?(?:api[-_]?key|apikey|access[-_]?token|auth[-_]?token|token|secret|signature|sig)=)[^\s&"'<>\\\x1b:;,)\]]+`)

	// Credentials inside a URL: scheme://user:password@host
	urlUserinfoRE = regexp.MustCompile(`(://)[^\s/@"'<>\\]*:[^\s/@"'<>\\]*@`)

	// An Authorization header value echoed back in an error: Bearer <token>
	// The token must be long enough to be one, so a sentence that says "the bearer of" is left alone.
	bearerRE = regexp.MustCompile(`(?i)(bearer\s+)[A-Za-z0-9._~+/-]{8,}=*`)
)

// Redact returns p with the secrets in it masked. Lines that cannot hold one are returned as
// they are, without a copy, so ordinary request logging costs a few byte scans.
func Redact(p []byte) []byte {
	if !mayHoldSecret(p) {
		return p
	}
	p = querySecretRE.ReplaceAll(p, []byte("${1}"+redactedMark))
	p = urlUserinfoRE.ReplaceAll(p, []byte("${1}"+redactedMark+"@"))
	p = bearerRE.ReplaceAll(p, []byte("${1}"+redactedMark))
	return p
}

// mayHoldSecret is the cheap pre-check: every pattern above needs one of these bytes or words.
func mayHoldSecret(p []byte) bool {
	return bytes.ContainsAny(p, "?&@") || bytes.Contains(p, []byte("earer")) || bytes.Contains(p, []byte("EARER"))
}

type redactingWriter struct{ w io.Writer }

// NewRedactingWriter returns a writer that masks secrets in everything written to w. Each Write
// is one log line (zerolog, log and gin all write a line per call), which is what the patterns
// expect.
func NewRedactingWriter(w io.Writer) io.Writer {
	return redactingWriter{w: w}
}

// Write reports len(p) on success, as io.Writer requires, even when masking changed the length.
func (r redactingWriter) Write(p []byte) (int, error) {
	if _, err := r.w.Write(Redact(p)); err != nil {
		return 0, err
	}
	return len(p), nil
}

// The standard logger and gin's writers are used all over the control API (the Solana workers
// log with log.Printf, and log lines are written before logging.Init runs), so they are masked
// from process start rather than from Init.
func init() {
	stdlog.SetOutput(NewRedactingWriter(os.Stderr))
	gin.DefaultWriter = NewRedactingWriter(os.Stdout)
	gin.DefaultErrorWriter = NewRedactingWriter(os.Stderr)
}
