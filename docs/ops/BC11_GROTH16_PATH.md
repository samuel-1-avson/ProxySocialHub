# BC-11 Groth16 on-chain path (Sprint B / BC-11-B)

## Why not Halo2-IPA on Solana

The Sprint A zk-prover uses **Halo2-IPA over the pasta/Pallas curve**. Solana’s
`alt_bn128` syscalls verify **BN254** pairings (Groth16 / PLONK-BN254), not pasta IPA.
Pasta Halo2 proofs therefore remain **off-chain only** (`POST /v1/prove/batch` +
`POST /v1/verify`). Oracle Ed25519 over Merkle `batch_root` remains the default
settlement lane until Groth16 is enabled.

## BC-11-B status (2026-08-11)

| Layer | State |
|-------|--------|
| Env `PROXYHUB_ZK_ONCHAIN_GROTH16` | Default **false** — require Groth16 lane |
| Env `PROXYHUB_ZK_ONCHAIN_GROTH16_READY` | Default **false** — allow live sends |
| Control-api gate | Fail-closes when flag on + ready false |
| Client `SubmitZKBatchGroth16` | Encodes ix + sends when ready; needs 256-byte wire proof |
| Program ix `submit_zk_batch_groth16` | Verifies via `groth16-solana` when built with `onchain-groth16`; else `OnchainGroth16Disabled` |
| Cargo feature `onchain-groth16` | Compiles verifier + embedded VK |
| Host tests | `cargo test -p proxyhub --features onchain-groth16 groth16` |
| BN254 prover service | `services/groth16-prover` — `POST /v1/prove/batch-groth16` |
| Aggregator | When `PROXYHUB_ZK_ONCHAIN_GROTH16=true`, proves via `GROTH16_PROVER_URL` then submits Groth16 ix |
| VK generator | `tools/gen-batch-vk` (host-verifies with groth16-solana) |
| Live deploy / READY | Devnet program live; READY can be true; require lane needs prover URL |

## Circuit / VK

1-public-input identity circuit over Fr (unchanged R1CS).

### Digest-v1 (Wave 4 / BC-11-B)

`public = Fr(SHA256(root ‖ session_count_le ‖ total_bytes_le ‖ period_start_le ‖ period_end_le))`

### Digest-v2 (Wave 5.A — leaf-committed)

```
leaves_hash = SHA256(leaf_0 ‖ … ‖ leaf_n-1)
public      = Fr(SHA256(root ‖ count_le ‖ bytes_le ‖ start_le ‖ end_le ‖ leaves_hash))
```

Proof system label: `groth16-bn254-batch-digest-v2`. Same VK / `VK_HASH` (identity
circuit). Does **not** prove Merkle-in-R1CS or edge bytes — see ADR 0010.

- Proving / setup: `services/solana-programs/proxyhub/tools/gen-batch-vk`
- Embedded: `programs/proxyhub/src/groth16_vk_generated.rs`
- `vk_hash` (hex): `2f1075c22786a7763bfaee9ec39188b2aec7fb19de0aa1c3aac9e7ce29519e72`
  (also `solana.BatchGroth16VKHashHex` in control-api)
- Proof wire: 256 bytes BE `A‖B‖C` with **A pre-negated**; G2 limb order `c1‖c0`

## Instruction — `submit_zk_batch_groth16`

| # | Account | Role |
|---|---------|------|
| 0 | `oracle` | signer (must be program admin) |
| 1 | `zk_batch` PDA `[b"zk_batch", root]` | `init` after verify |
| 2 | `system_program` | rent |
| 3 | `program_state` | pause + admin |
| 4 | `groth16_proof` | 256-byte proof account |
| 5 | `groth16_vk` | optional 32-byte VK_HASH pin (else inert placeholder) |

Args: `batch_root`, `session_count`, `total_bytes`, `period_start`, `period_end`,
`leaves_hash`, `proof_hash`, `vk_hash`, `proof` (256).

## Feature flags

| Env / Cargo | Default | Meaning |
|-------------|---------|---------|
| `PROXYHUB_ZK_ONCHAIN_GROTH16` | `false` | Settlement must use Groth16 path |
| `PROXYHUB_ZK_ONCHAIN_GROTH16_READY` | `false` | Control-api may send Groth16 txs |
| `GROTH16_PROVER_URL` | unset | BN254 prover HTTP base (compose profile `groth16`) |
| `GROTH16_PROVER_REQUIRED` | `false` | Fail settle if prove fails (also implied by GROTH16=true) |
| Cargo `onchain-groth16` | off | Program includes verifier |

Enable order: build+deploy with feature → set READY → start groth16-prover → set GROTH16 require flag.

## Sprint A honesty statement

Default settlement language remains **oracle-attested Merkle batch anchor** with
optional off-chain Halo2 blob. Groth16 on-chain verify is an **opt-in** lane.
