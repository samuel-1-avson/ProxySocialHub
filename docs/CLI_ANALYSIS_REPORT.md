# ProxyHub Provider CLI — Deep Dive Analysis Report

**Date:** 2026-03-16
**Scope:** Full code review of `services/control-api/cmd/provider-cli/`
**Reviewer:** Claude Sonnet 4.6 — Expert Go / CLI / Distributed Systems Review

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [File Inventory](#2-file-inventory)
3. [Bugs & Critical Issues](#3-bugs--critical-issues)
4. [Code Quality Issues](#4-code-quality-issues)
5. [Architecture Weaknesses](#5-architecture-weaknesses)
6. [Security Issues](#6-security-issues)
7. [Stub / Unimplemented Features](#7-stub--unimplemented-features)
8. [Pros & Strengths](#8-pros--strengths)
9. [Recommendations — Improvements & New Features](#9-recommendations--improvements--new-features)
10. [Priority Fix Matrix](#10-priority-fix-matrix)

---

## 1. Architecture Overview

The Provider CLI is a Go binary built with **Cobra** (command framework), **Viper** (config),
and **Zap** (logging). It serves as the on-machine agent for proxy node operators and communicates
with two systems:

```
Provider CLI
    │
    ├── Control API (HTTPS REST)
    │   └── Node registration, token management, status
    │
    └── Edge Gateway (TCP / TLS + Yamux)
        └── Authentication → Capability declaration → Stream proxying
```

### Connection Protocol Stack

```
TCP (or TLS over TCP)
    └── Yamux (multiplexed streams)
            ├── AUTH stream      → "AUTH <token>\n"  → "OK\n"
            ├── CAPABILITY stream → "CAPABILITY <JSON>\n" → "ACK <JSON>\n"
            ├── HEARTBEAT stream  → "HEARTBEAT:<id>:<ts>:<JSON>\n"  (every 30s)
            └── PROXY streams     → "CONNECT <host:port>\n" → "OK\n" → data bridge
```

### Command Tree

```
provider-cli
├── config
│   ├── set <key> <value>
│   ├── get <key>
│   ├── show
│   └── init
├── node
│   ├── list
│   ├── status <id>
│   ├── register
│   ├── start         ← core long-running process
│   ├── stop
│   ├── metrics       ← STUB
│   └── logs
├── service
│   ├── install       ← Linux systemd only
│   ├── uninstall
│   ├── start
│   ├── stop
│   ├── status
│   └── logs
├── doctor
├── wizard
└── version
```

---

## 2. File Inventory

| File | Lines | Purpose |
|---|---|---|
| `cmd/root.go` | 199 | Root command, `config` subcommands, Viper init |
| `cmd/node.go` | 521 | Node commands: list, status, register, start, stop, metrics, logs |
| `cmd/service.go` | 247 | System service management (systemd) |
| `cmd/doctor.go` | 210 | Diagnostic health checks |
| `cmd/wizard.go` | 266 | Interactive setup wizard |
| `cmd/version.go` | 49 | Version info display |
| `internal/config/config.go` | 170 | Config struct, Load/Save/Validate |
| `internal/tunnel/client.go` | 395 | Edge Gateway tunnel client |
| `internal/tunnel/heartbeat.go` | 189 | Periodic heartbeat sender |
| `internal/proxy/handler.go` | 309 | HTTP CONNECT stream handler |
| `internal/stats/collector.go` | 134 | Bandwidth + connection statistics |

---

## 3. Bugs & Critical Issues

### B1. PID File Uses Hardcoded Windows Path Separators
**File:** `cmd/node.go:481–497`
**Severity:** CRITICAL (runtime crash on Linux/macOS)

```go
// writePIDFile():
pidDir := home + "\\.proxyhubb"      // Windows backslash — WRONG on Linux/macOS

// removePIDFile():
pidFile := home + "\\.proxyhubb\\provider.pid"  // Same issue
```

The node runs primarily on Linux servers. `filepath.Join()` uses OS-appropriate separators.
These hardcoded backslashes will produce a literal path like `/home/user\.proxyhubb\provider.pid`
on Linux — a single directory named `.proxyhubb\provider.pid` — meaning the PID file is never
written or found, and `node stop` always fails with "no running node found."

**Fix:** Use `filepath.Join(home, ".proxyhubb")` and `filepath.Join(pidDir, "provider.pid")`.

---

### B2. `version.go` Panics on Short GitCommit
**File:** `cmd/version.go:40`
**Severity:** HIGH

```go
fmt.Printf("provider-cli version %s (%s)\n", tunnel.Version, GitCommit[:7])
```

If `GitCommit` is shorter than 7 characters (e.g., `"dev"` or `"abc"`), this panics with
`runtime error: slice bounds out of range`. While the default is `"unknown"` (7 chars, safe),
any CI pipeline that sets a short value will cause a crash on `provider-cli version`.

**Fix:** `if len(GitCommit) >= 7 { GitCommit[:7] } else { GitCommit }`

---

### B3. `doctor` API Check Passes API Key as a URL
**File:** `cmd/doctor.go:169`
**Severity:** HIGH (check is completely broken)

```go
func checkAPI() (bool, string) {
    cfg, _ := config.Load("")
    ...
    resp, err := client.Get(cfg.APIKey)  // cfg.APIKey is a token string, NOT a URL!
```

`cfg.APIKey` is an authentication token like `"pk_live_abc123..."`. Passing it to `http.Get()`
will always fail with `unsupported protocol scheme ""` because it's not a URL. The function
silently swallows this and returns `true` with "API connectivity check skipped" — so the doctor
never actually tests API connectivity. This gives providers false confidence.

**Fix:** Construct the actual health URL: `client.Get(cfg.APIBaseURL + "/health")` with the
API key in the Authorization header.

---

### B4. `HeartbeatManager.isRunning` is a Non-Atomic Bool (Data Race)
**File:** `internal/tunnel/heartbeat.go:65–101`
**Severity:** HIGH

```go
type HeartbeatManager struct {
    ...
    isRunning bool  // Plain bool, not atomic, no mutex
}

func (h *HeartbeatManager) Start() {
    if h.isRunning { return }   // Read without lock
    h.isRunning = true           // Write without lock — DATA RACE
}

func (h *HeartbeatManager) Stop() {
    if !h.isRunning { return }  // Read without lock
    h.isRunning = false          // Write without lock — DATA RACE
}
```

`Start()` is called from a goroutine in `node.go`. `Stop()` is called from the shutdown
goroutine. Reading and writing `isRunning` concurrently without synchronization is a data race
detectable with `go test -race` and can cause undefined behavior (missed Stop, double Close).

**Fix:** Use `sync/atomic.Int32` or a `sync.Mutex` guard on `isRunning`, matching the pattern
already used correctly in `tunnel/client.go`.

---

### B5. `bridge()` Uses Unsafe Type Assertions — Will Panic
**File:** `internal/proxy/handler.go:159,170`
**Severity:** HIGH

```go
// Client -> Target goroutine:
target.(*net.TCPConn).CloseWrite()    // Panics if target is not *net.TCPConn

// Target -> Client goroutine:
client.(*yamux.Stream).Close()         // Panics if client is not *yamux.Stream
```

Both `client` and `target` are typed as `io.ReadWriteCloser` interfaces. Any wrapping
(e.g., a TLS layer, a buffered wrapper) would cause an immediate panic at runtime.
There is no recovery in this goroutine, so the panic propagates up and kills the stream handler.

**Fix:** Add graceful half-close via an interface check:
```go
if tc, ok := target.(interface{ CloseWrite() error }); ok {
    tc.CloseWrite()
}
```

---

### B6. `wizard.go:installService()` Silently Does Nothing
**File:** `cmd/wizard.go:253–261`
**Severity:** MEDIUM (misleads providers)

```go
func installService() error {
    if runtime.GOOS != "linux" {
        return fmt.Errorf("service installation only supported on Linux")
    }
    // TODO: Implement systemd service installation
    return nil   // Returns success without doing ANYTHING
}
```

The wizard tells the user `✓ Service installed successfully` and prints systemctl commands,
but the service file was never written. On the next reboot, nothing auto-starts.

**Fix:** Call `serviceInstallCmd.RunE` logic directly, or route through the proper
`service install` subcommand.

---

### B7. `service install` Creates Wrong `HOME` Path for Root
**File:** `cmd/service.go:57–71`
**Severity:** MEDIUM

```go
user := os.Getenv("SUDO_USER")
if user == "" {
    user = "root"
}
serviceContent := fmt.Sprintf(`
...
Environment="HOME=/home/%s"
`, user, execPath, user)
```

When `user = "root"`, the service sets `HOME=/home/root` — but root's home is `/root`,
not `/home/root`. This means the service cannot find the config file at startup.

**Fix:** If user is `"root"`, use `HOME=/root`. Otherwise `/home/<user>`.

---

### B8. `node stop` Removes PID File Before Verifying Process Died
**File:** `cmd/node.go:455–470`
**Severity:** LOW

```go
process.Signal(syscall.SIGTERM)
fmt.Println("Node stop signal sent successfully.")
os.Remove(pidFile)  // Removed immediately — process may still be running
```

If the process takes time to shut down (30-second drain timeout in `client.go`), the PID file
is gone before the process exits. A subsequent `node start` could create a new process
while the old one is still draining, leading to two concurrent tunnel clients.

**Fix:** After sending SIGTERM, poll for process exit (with a 30-second timeout) before
removing the PID file.

---

## 4. Code Quality Issues

### Q1. `metricsCmd` is a Redirect, Not a Feature
**File:** `cmd/node.go:380–392`

```go
var metricsCmd = &cobra.Command{
    Use: "metrics",
    Run: func(cmd *cobra.Command, args []string) {
        fmt.Println("Metrics feature requires the node to be running.")
        fmt.Println("For now, check metrics via the web dashboard:")
    },
}
```

The entire `node metrics` command just prints a web URL. Users expect a terminal command
to show terminal metrics.

---

### Q2. `config show` Leaks Credentials in Plaintext
**File:** `cmd/root.go:143–165`

```go
fmt.Printf("Node ID:        %s\n", cfg.NodeID)
// ...but DOES NOT print jwt_token or api_key
```

The `show` command omits sensitive fields, which is good — but `config get jwt_token` and
`config get api_key` return the full token string via Viper, with no masking at all.

---

### Q3. Connection Type Detection Always Returns "residential"
**File:** `internal/tunnel/client.go:380–383`

```go
func detectConnectionType() string {
    return "residential"  // Always hardcoded
}
```

Every provider's capabilities report says "residential" regardless of their actual connection.
This affects smart-matching quality and provider tier evaluation.

---

### Q4. Memory Reporting Always Returns 4096 MB
**File:** `internal/tunnel/client.go:386–389`

```go
func getMemoryMB() uint64 {
    return 4096  // Default 4GB — always wrong
}
```

The gateway receives fake system stats. If the system has 512 MB or 64 GB, it will always
report 4 GB. This affects gateway quality scoring.

---

### Q5. CPU / Memory Stats in Heartbeat Always Report Zero
**File:** `internal/tunnel/heartbeat.go:171–177`

```go
func (h *HeartbeatManager) collectSystemStats() SystemStats {
    return SystemStats{
        CPUPercent:    0.0,  // TODO: Implement proper CPU measurement
        MemoryPercent: 0.0,  // TODO: Implement proper memory measurement
        ...
    }
}
```

Every heartbeat reports 0% CPU and 0% memory. The gateway cannot make intelligent routing
decisions based on node load because it always sees idle stats.

---

### Q6. `node register` Does Not Auto-Save Node ID
**File:** `cmd/node.go:186–199`

After successful registration, the API response contains the `node_id`. The CLI prints:
```
Next steps:
1. Save your node configuration:
   provider-cli config set node_id <node_id_from_response>
```
But it never actually parses and saves the `node_id` from the JSON response body.
Providers must manually copy-paste it — error-prone for non-technical users.

---

### Q7. Heartbeat Frame Format is Redundant
**File:** `internal/tunnel/heartbeat.go:120–124`

```go
frame := fmt.Sprintf("HEARTBEAT:%s:%d:%s\n",
    msg.NodeID,
    msg.Timestamp,
    string(data),  // data already contains NodeID and Timestamp inside the JSON
)
```

The JSON payload (`data`) already contains `node_id` and `timestamp`. The outer frame
duplicates these fields, wasting ~50 bytes per heartbeat and making the protocol harder
to parse correctly.

---

### Q8. No Output Format Flag for Scripting
All commands print human-readable tabwriter output. There is no `--output json` or
`--output yaml` flag. This prevents:
- Integration with monitoring scripts
- Parsing in CI/CD pipelines
- Feeding into other tools (jq, grafana agent, etc.)

---

### Q9. `node logs` Reads Entire Log File into Memory
**File:** `cmd/node.go:414–427`

```go
data, err := os.ReadFile(logFile)   // Reads ENTIRE file
...
if len(lines) > 2000 {
    lines = lines[len(lines)-2000:]  // Then trims to 2000 chars
```

For a long-running node, the log file could be hundreds of MB. Reading the entire file
into memory to then discard 99% of it is wasteful. Should use `tail -n` equivalent
(seek to end, read backwards).

---

## 5. Architecture Weaknesses

### A1. No IPC Between Running Node and CLI Commands
The running `node start` process has no local HTTP server, Unix socket, or shared memory.
This means:
- `node stop` works only via OS signals + PID file — fragile
- `node metrics` cannot query the live process at all
- `node logs` reads a static file, not a live stream

**Impact:** Operators cannot interact with a running node without killing it.
**Fix:** Start a local management HTTP server (e.g., `localhost:9090/metrics`,
`localhost:9090/status`) inside `node start`. Other commands query this socket.

---

### A2. Reconnect Loop Has No Exponential Backoff
**File:** `cmd/node.go:303–373`

```go
reconnectInterval := cfg.ReconnectInterval  // Fixed 30 seconds always
```

Every reconnect waits exactly 30 seconds — no backoff. If the gateway is down for
30 minutes, the CLI hammers it with a connection attempt every 30 seconds. This creates
unnecessary noise and load on the gateway during incidents.

**Fix:** Implement exponential backoff with jitter:
`30s → 60s → 120s → 240s → 300s max`

---

### A3. `node start` Has No Daemon Mode
The process runs in the foreground. While `service install` wraps it in systemd,
there is no built-in `--daemon` or `--background` flag for users who want background
execution without systemd (e.g., inside Docker, on macOS, on Windows).

---

### A4. TLS Custom CA Certificate Not Implemented
**File:** `internal/tunnel/client.go:119–122`

```go
if c.config.TLSCertPath != "" {
    // TODO: Load custom CA cert
    c.logger.Warn("Custom TLS cert path not yet implemented")
}
```

Providers in enterprise environments or behind corporate proxies with private CAs cannot
verify the gateway TLS certificate. They must either use `TLSSkipVerify: true`
(insecure) or wait for this feature.

---

### A5. Service Install Only Supports Linux systemd
`service install`, `service start`, `service stop`, `service status`, `service logs` —
all immediately return an error on macOS and Windows with no alternative provided.
The wizard's service install step silently fails on non-Linux (see B6).

---

### A6. No Version Manifest or Auto-Update
Version is hardcoded as `"1.0.0"` in `tunnel/client.go`. There is no:
- Update check command
- Automatic update notification at startup
- Version pinning or channel (stable/beta)

---

## 6. Security Issues

### S1. Credentials Stored in Plaintext YAML
**File:** `internal/config/config.go:142–157`

The config file at `~/.proxyhubb/provider.yaml` contains `jwt_token` and `api_key` in
plaintext. The directory is created with `0700` permissions (correct), but the file
is written with `viper.WriteConfigAs()` which uses default permissions (`0644`),
meaning any user on the system can read the credentials:

```
-rw-r--r-- 1 user user 341 Mar 16 12:00 /home/user/.proxyhubb/provider.yaml
```

**Fix:** Write config file with `0600` permissions. Ideally integrate OS keychain
(macOS Keychain, Windows Credential Manager, Linux libsecret via keyring package).

---

### S2. `config init` Shows JWT Token in Terminal
**File:** `cmd/root.go:177`

```go
fmt.Print("Enter JWT Token: ")
fmt.Scanln(&cfg.JWTToken)  // Token visible in terminal, in shell history
```

JWT tokens typed here appear in the terminal in plaintext and are stored in shell history
(`~/.bash_history`, `~/.zsh_history`).

**Fix:** Use `golang.org/x/term.ReadPassword()` which suppresses echo.

---

### S3. `TLSSkipVerify` Config Field Has No Warning
**File:** `internal/config/config.go:24`

```go
TLSSkipVerify bool `mapstructure:"tls_skip_verify"`
```

The field exists with no validation warning when set to `true`. A user who sets this to
avoid a certificate error silently disables TLS verification for all gateway connections,
making the tunnel vulnerable to MITM.

**Fix:** On startup, if `TLSSkipVerify = true`, print a prominent security warning:
```
⚠️  WARNING: TLS certificate verification is DISABLED.
    Your connection to the gateway is vulnerable to man-in-the-middle attacks.
```

---

### S4. Auth Token Sent in Custom Text Protocol Without Framing
**File:** `internal/tunnel/client.go:183`

```go
authMsg := fmt.Sprintf("AUTH %s\n", token)
stream.Write([]byte(authMsg))
```

Tokens are sent as `AUTH <token>\n` in a custom line-based protocol. There is no:
- Message length framing (a token containing `\n` would be truncated)
- Encryption beyond the outer TLS layer
- Timestamp or nonce to prevent replay if TLS is bypassed

**Fix:** Use JSON framing: `{"type":"auth","token":"...","timestamp":1234567890}` and
validate timestamp freshness server-side.

---

## 7. Stub / Unimplemented Features

| Feature | File | Status | Impact |
|---|---|---|---|
| `node metrics` display | `node.go:380` | Stub — prints web URL | HIGH — operators cannot inspect live stats |
| CPU % in heartbeat | `heartbeat.go:171` | Always 0.0 | HIGH — gateway gets bad routing data |
| Memory % in heartbeat | `heartbeat.go:172` | Always 0.0 | HIGH — same |
| Real memory detection | `client.go:387` | Always 4096 MB | MEDIUM |
| Connection type detection | `client.go:381` | Always "residential" | MEDIUM |
| Custom TLS CA loading | `client.go:121` | TODO comment | MEDIUM |
| `wizard` service install | `wizard.go:259` | Returns nil, does nothing | MEDIUM |
| API connectivity check | `doctor.go:169` | Passes token as URL | HIGH |
| Windows service support | `service.go:28` | "planned" | MEDIUM |
| macOS launchd support | `service.go:25` | "partial" only | MEDIUM |
| Bandwidth rate in heartbeat | `heartbeat.go:156` | Always 0 | LOW |

---

## 8. Pros & Strengths

| # | Strength | Detail |
|---|---|---|
| 1 | **Solid connection architecture** | Yamux multiplexing over TLS is production-grade. Authentication + capability handshake is well-structured |
| 2 | **Atomic stats collection** | `stats/collector.go` uses `sync/atomic` correctly for lock-free counters |
| 3 | **Graceful shutdown** | `client.go` uses `WaitGroup` with timeout drain, SIGTERM handling in `node start` |
| 4 | **Port + host access control** | `proxy/handler.go` validates allowed ports, blocked hosts, and private IP ranges |
| 5 | **Private IP blocking** | Correctly blocks RFC 1918, loopback, and link-local in `isValidTarget()` |
| 6 | **Config flexibility** | Viper supports file + env vars (`PROXYHUB_*` prefix). CLI flags override config |
| 7 | **Structured logging** | Zap logger with debug/info levels. Well-instrumented connection lifecycle |
| 8 | **Reconnect loop** | Auto-reconnects on disconnect. Runs indefinitely until SIGTERM |
| 9 | **Cross-platform build scripts** | Both `.sh` and `.ps1` build scripts for Windows/Linux/macOS targets |
| 10 | **systemd service integration** | Full install/uninstall/start/stop/logs for Linux providers |

---

## 9. Recommendations — Improvements & New Features

### R1. Fix All Bugs (Section 3) — Required Before Production

These must be fixed before any public provider onboarding:
- B1: PID file path separators (Linux crash)
- B2: `version` panic on short GitCommit
- B3: Doctor API check (broken — always passes)
- B4: Heartbeat `isRunning` data race
- B5: `bridge()` unsafe type assertions (panic risk)
- B6: Wizard `installService()` silent no-op
- B7: Systemd service `HOME=/home/root` → `/root`

---

### R2. Implement Real `node metrics` Command

**What to build:**
Start a local management HTTP server inside the `node start` process on `localhost:9095/metrics`
and `localhost:9095/status`. Other CLI invocations query this endpoint.

```
provider-cli node metrics
╔══════════════════════════════════════════════════════╗
║  ProxyHub Provider Node — Live Metrics               ║
║  Node: abc12345 | Uptime: 2h 14m | Status: ACTIVE   ║
╠═════════════════════════╦════════════════════════════╣
║  Active Connections     ║   47 / 100 max             ║
║  Total Connections      ║   1,284 (session)          ║
║  Bandwidth Up           ║   1.24 GB                  ║
║  Bandwidth Down         ║   8.73 GB                  ║
║  Current Rate           ║   ↑ 4.2 Mbps  ↓ 18.3 Mbps ║
║  CPU Usage              ║   12%                      ║
║  Memory Usage           ║   34%  (1.4 GB / 4 GB)    ║
║  Heartbeat              ║   28s ago  ✓               ║
╠═════════════════════════╬════════════════════════════╣
║  SOL Earned (session)   ║   0.0042 SOL               ║
║  SOL Earned (today)     ║   0.0187 SOL               ║
╚═════════════════════════╩════════════════════════════╝
(Refreshes every 2s. Press Ctrl+C to exit)
```

---

### R3. Add Exponential Backoff with Jitter to Reconnect Loop

Replace the fixed 30-second reconnect with:
```
Attempt 1:  5s
Attempt 2:  10s
Attempt 3:  20s
Attempt 4:  40s
Attempt 5+: 60s max + random ±10% jitter
```

Prevents thundering herd on gateway restart.

---

### R4. Implement Real System Stats (CPU, Memory, Network)

Use `github.com/shirou/gopsutil/v3` (already used in many Go projects) for accurate:
- CPU usage percentage (5-second rolling average)
- Memory usage (RSS + swap)
- Network interface bytes/second
- Disk I/O (for disk-based nodes)

Replace the hardcoded `0.0` / `4096` stubs.

---

### R5. Auto-Save `node_id` After Registration

After `node register` succeeds, parse the response body and automatically run:
```go
cfg.NodeID = response.NodeID
cfg.Save()
fmt.Printf("✓ Node ID saved: %s\n", response.NodeID)
```

Removes a manual copy-paste step that trips up non-technical providers.

---

### R6. Add `--output` Flag for JSON/Table Output

Add a global `--output` flag with values: `table` (default), `json`, `yaml`.

```bash
# Machine-readable output for scripts
provider-cli node list --output json | jq '.nodes[] | select(.status == "online")'
provider-cli node metrics --output json | jq '.bandwidth.rate_kbps'
```

---

### R7. Implement `node earn` Command

Show earnings summary fetched from the Control API:

```
provider-cli node earn

--- Earnings Report ---
Node:           abc12345
Period:         Last 30 days

Today:          0.0187 SOL  ($3.74)
This week:      0.1243 SOL  ($24.86)
This month:     0.5122 SOL  ($102.44)
All time:       3.8741 SOL  ($774.82)

Pending payout: 0.0623 SOL  (processes in ~12 min)
Next payout:    Estimated 15:47 UTC

Tier:           Verified  (Quality score: 94.2/100)
Uptime:         99.1% (30d)
```

---

### R8. Implement `node update` Command

Allow updating node registration without re-registering:

```bash
provider-cli node update --bandwidth 200 --type residential --max-connections 150
```

Calls `PUT /v1/provider/nodes/:id` with updated fields.

---

### R9. Add `config validate` Command

Test credentials and connectivity against the actual API:

```bash
provider-cli config validate

Checking configuration...
  ✓ Config file found at ~/.proxyhubb/provider.yaml
  ✓ API key is valid (expires: never)
  ✓ JWT token is valid (expires in 18h 42m)
  ✓ Control API is reachable (latency: 42ms)
  ✓ Edge Gateway is reachable (latency: 8ms, TLS: valid)
  ✓ Node abc12345 is registered and active

All checks passed.
```

---

### R10. Encrypt Stored Credentials via OS Keychain

Rather than plaintext in `~/.proxyhubb/provider.yaml`, store sensitive values in
the OS native keychain:
- **macOS:** Keychain via `github.com/zalando/go-keyring`
- **Linux:** libsecret / GNOME Keyring
- **Windows:** Windows Credential Manager

Config YAML stores non-sensitive values only. Token is fetched from keychain at runtime.

---

### R11. Implement `doctor --fix` Auto-Repair

After diagnosing issues, offer to fix common ones automatically:

```
✗ FAIL Gateway Connectivity
  → Cannot connect to gateway.proxyhubb.com:4000
  Attempt auto-fix? [Y/n]: y
  → Testing alternative gateway endpoints...
  → Trying gateway-eu.proxyhubb.com:4000... ✓ Connected!
  → Updating gateway_addr in config
  ✓ Fixed!
```

---

### R12. Add macOS launchd Service Support

Generate a proper `~/Library/LaunchAgents/com.proxyhubb.provider.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" ...>
<plist version="1.0">
<dict>
    <key>Label</key><string>com.proxyhubb.provider</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/provider-cli</string>
        <string>node</string><string>start</string>
    </array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
</dict>
</plist>
```

---

### R13. Add Windows Service Support (NSSM or native)

Use `golang.org/x/sys/windows/svc` for native Windows service integration,
or generate an NSSM config for providers on Windows Server.

---

### R14. Add `node tail` — Live Connection Stream

Stream live proxy connections as they happen:

```
provider-cli node tail

[15:42:01] CONNECT api.github.com:443      → OK  (TLS)    192.168.1.100
[15:42:01] CONNECT fonts.googleapis.com:443 → OK  (TLS)    192.168.1.100
[15:42:02] CONNECT ads.tracking.com:443    → BLOCKED (host policy)
[15:42:03] CONNECT example.com:80         → OK  (HTTP)   192.168.1.100
```

---

### R15. Add `provider-cli update` Self-Update Command

Check for new version from the CLI manifest endpoint:

```bash
provider-cli update

Current version:  1.0.0
Latest version:   1.2.3

Changelog:
  1.2.3 - Fix heartbeat data race, add macOS service support
  1.2.2 - Add node earn command, exponential backoff
  1.2.1 - Fix PID file path on Linux

Download and install v1.2.3? [Y/n]: y
✓ Updated to v1.2.3. Restart your node to apply.
```

---

### R16. Add `--daemon` Flag to `node start`

For non-systemd environments (Docker, macOS, CI):

```bash
provider-cli node start --daemon   # Daemonizes using double-fork
provider-cli node start --daemon --log-file /var/log/proxyhub.log
```

---

### R17. Structured Exit Codes

Currently all failures exit with `os.Exit(1)`. Add meaningful exit codes:

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | General error |
| 2 | Configuration error (missing API key, bad config file) |
| 3 | Connectivity error (gateway unreachable, API down) |
| 4 | Authentication error (invalid token, expired) |
| 5 | Node not registered |
| 6 | Already running |

This enables monitoring scripts to react differently to each failure mode.

---

## 10. Priority Fix Matrix

### Bugs — Must Fix Before Production

| ID | Issue | File | Effort |
|---|---|---|---|
| B1 | PID file Windows backslashes — Linux crash | `node.go:481` | 5 min |
| B2 | `version` panic on short GitCommit | `version.go:40` | 5 min |
| B3 | Doctor API check uses token as URL | `doctor.go:169` | 15 min |
| B4 | Heartbeat `isRunning` data race | `heartbeat.go:65` | 15 min |
| B5 | `bridge()` unsafe type assertions | `handler.go:159` | 15 min |
| B6 | Wizard `installService()` silent no-op | `wizard.go:259` | 30 min |
| B7 | Systemd `HOME=/home/root` vs `/root` | `service.go:68` | 5 min |

### Improvements — High Value

| ID | Recommendation | Effort |
|---|---|---|
| R2 | Real `node metrics` with local HTTP server | 3 days |
| R3 | Exponential backoff reconnect | 1 hour |
| R4 | Real CPU/memory stats via gopsutil | 2 hours |
| R5 | Auto-save node_id after register | 30 min |
| R6 | `--output json` flag | 2 hours |
| R7 | `node earn` earnings command | 1 day |
| R10 | OS keychain credential storage | 1 day |

### Enhancements — Nice to Have

| ID | Recommendation | Effort |
|---|---|---|
| R8 | `node update` registration update | 1 day |
| R9 | `config validate` live check | 2 hours |
| R11 | `doctor --fix` auto-repair | 2 days |
| R12 | macOS launchd service support | 1 day |
| R13 | Windows service support | 2 days |
| R14 | `node tail` live connection stream | 2 days |
| R15 | `provider-cli update` self-update | 1 day |
| R16 | `--daemon` background mode | 1 day |
| R17 | Structured exit codes | 2 hours |

---

*Report: 2026-03-16 | ProxyHub Provider CLI v1.0.0 | Reviewer: Claude Sonnet 4.6*
