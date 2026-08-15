# W4.2 — Reputation program live on Solana devnet

| Field | Value |
|-------|-------|
| Date | 2026-08-11 |
| Result | `BC11_REPUTATION_DEVNET_DEPLOYED` |
| Program ID | `EnVE6ehKA2dYi69B3Lo8wt2wyDgzLw4tdtSEKoMYe5bF` |
| Deploy signature | `3q8AFBcitUTm7BmfJRTN8xoNNTULsDAcN25PdYQuwR3o42fBc3LQeHJsGTn1QfwitHH3KQ9bR8kjumZ3fXzK63jn` |
| Authority | `8P4uuapgGfW8L7VvdQJ9W7RpJqpfyifhPx9UQaHnKii2` |
| ProgramData | `23X9J8oWL1FUiccxamvwjV7aWiLbdyRkYLqo9qRDxZUz` |
| Slot | `482906179` |
| Bytecode SHA256 | `8f55c5fb6cc2aef1681465d7b97ea296abfb0acf0249821ab9912d31fc92fd92` |
| Data length | 258160 bytes |

## Verify

```bash
solana program show EnVE6ehKA2dYi69B3Lo8wt2wyDgzLw4tdtSEKoMYe5bF --url https://api.devnet.solana.com
```

## Post-deploy still required

1. `initialize_config(oracle)` as admin (upgrade authority wallet)
2. `set_deploy_allowed(true)` before provider/score mutations
3. Point live env: `REPUTATION_PROGRAM_ID=EnVE6ehKA2dYi69B3Lo8wt2wyDgzLw4tdtSEKoMYe5bF`

## Non-claims

- `deploy_allowed` still defaults false until admin ix
- Groth16 on-chain verify still not ready
- No mainnet deploy
