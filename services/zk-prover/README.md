# ProxyHubb ZK Prover (Phase 5a)

This service is the Phase 5a external prover used by control-api.
It generates real Halo2 proofs (IPA over Pasta curves) for batch digests produced from settlement payloads.

## Endpoints

- GET /healthz
- POST /v1/prove/batch

Example request payload:

{
  "batch_root": "<64 hex chars>",
  "session_count": 10,
  "total_bytes": 123456,
  "period_start": 1711900000,
  "period_end": 1711900900,
  "leaf_hashes": ["<64 hex chars>"]
}

Response payload:

{
  "proof_base64": "...",
  "proof_system": "halo2-ipa-pasta-v1",
  "public_signals": ["<batch_digest_hex>", "<batch_root>", "<total_bytes>"]
}

## Environment

- PORT (optional, default 8095)
- RUST_LOG (optional)

## Run

cargo run

## Notes

The current circuit proves equality between a private batch digest witness and a public signal.
The digest is derived from batch_root, session_count, total_bytes, period window, and all leaf hashes.
This is a real Halo2 proof pipeline and can be extended to richer constraints in the next increment.
