# Provider Stats Collection Agent

## Purpose
Collect system stats without violating privacy.

---

## Metrics Collected
- CPU usage
- RAM availability
- Network throughput
- Uptime

---

## Agent Design
- Runs locally
- Rust-based
- Signed binary
- Sends aggregated metrics

---

## Security
- No file access
- No payload inspection
- mTLS to gateway

---

## Reporting Interval
- Default: 30s

