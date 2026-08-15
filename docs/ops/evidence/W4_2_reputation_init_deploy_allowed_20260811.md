# W4.2 post-deploy — initialize_config + set_deploy_allowed

| Field | Value |
|-------|-------|
| Date | 2026-08-11 |
| Result | `REPUTATION_DEPLOY_ALLOWED_TRUE` |
| Program | `EnVE6ehKA2dYi69B3Lo8wt2wyDgzLw4tdtSEKoMYe5bF` |
| oracle_config PDA | `HVDvJk86pQ98gq34BcwctG46hQGG4bLEYRMZxPH6giW4` |
| Admin / oracle | `8P4uuapgGfW8L7VvdQJ9W7RpJqpfyifhPx9UQaHnKii2` |

## Transactions

| Ix | Signature |
|----|-----------|
| `initialize_config` | `33gw97uZdBdidiyEq4dWs51p3A5BVTvReLvGoRwFeEQN5reJeGK5ysZxbSnSNWyyTfpt37U4cLchjyTvXqsoZN59` |
| `set_deploy_allowed(true)` | `4jwUh5zvZw55UWZE7Sw3ewzGnKhRDGuGBb3wfMEfBqB35aXquT18AHKNELPYdWnwzgpyxmktsLXiJgPdSPorNTKx` |

## Account state

`oracle_config` owner = reputation program; final byte pair `01 ff` → `deploy_allowed=true`, bump=`0xff`.

## Tooling

`go run ./cmd/reputation_init_devnet` (waits after init before allow flip).
