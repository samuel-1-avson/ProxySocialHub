# S7 Custody + Migration Evidence — 20260808T130406Z

Host: `proxyhubb-testnet` · Project dir: `/opt/proxyhubb`

## Summary checks
| Check | Result | Detail |
|-------|--------|--------|
| migration 000116 | PASS | 000116_ledger_append_only_lamports 000124_ledger_journal 000137_ledger_revoke_app_mutate 000138_ledger_revoke_truncate  |
| migration 000124 | PASS |  |
| migration 000137 | PASS |  |
| migration 000138 | PASS |  |
| ledger_journal_lines table | PASS |  |
| wallets.balance_lamports | PASS |  |
| append-only trigger | PASS | count=1 |
| destination_kind=vault | PASS | vault |
| DEPOSIT_VAULT_UI | PASS |  |
| DEPOSIT_VAULT_CREDIT | PASS |  |
| LEGACY_TREASURY_CREDIT=false | PASS |  |
| DEPOSIT_REQUIRE_FINALIZED | PASS |  |
| REQUIRE_ESCROW_PDA | PASS |  |
| oracle GCP KMS fail-closed | PASS | pubkey=8P4uuapg… key_set=yes |
| hot GCP KMS fail-closed | PASS | pubkey=FeunrDoA… |
| vault ≠ hot | PASS | vault=8LZji2G9… hot=FeunrDoA… |
| vault ≠ oracle | PASS |  |
| hot ≠ oracle | PASS |  |
| cold ≠ hot | PASS | cold=3MrGGqkG… |
| no oracle/hot file keypaths in container | PASS |  |

## Address inventory (public / env)
```
destination_kind=vault
deposit_vault=8LZji2G9nn7ywoLwopgcREpm5xQHpvRJY1az1R9hHRzm
treasury_solana_public=8LZji2G9nn7ywoLwopgcREpm5xQHpvRJY1az1R9hHRzm
hot=FeunrDoACmUi4fFQtiw3fPHAqB3N9UrAsj8ZzqSsGPa3
oracle=8P4uuapgGfW8L7VvdQJ9W7RpJqpfyifhPx9UQaHnKii2
cold=3MrGGqkGKSfmgBBY8s537HX2Sk4zK4qCHCDdW3yGwCCZ
distinct_nonempty_count=4
```

## Devnet balances (lamports)
```
vault=8LZji2G9nn7ywoLwopgcREpm5xQHpvRJY1az1R9hHRzm raw=10000000
hot=FeunrDoACmUi4fFQtiw3fPHAqB3N9UrAsj8ZzqSsGPa3 raw=7219990400
oracle=8P4uuapgGfW8L7VvdQJ9W7RpJqpfyifhPx9UQaHnKii2 raw=7307863960
cold=3MrGGqkGKSfmgBBY8s537HX2Sk4zK4qCHCDdW3yGwCCZ raw=5171775000
```

## schema_migrations (target set)
```
000116_ledger_append_only_lamports
000124_ledger_journal
000137_ledger_revoke_app_mutate
000138_ledger_revoke_truncate
```

## system health (truncated)
```
{"healthy":true,"database":{"name":"PostgreSQL","healthy":true,"latency":"727.268µs"},"redis":{"name":"Redis","healthy":true,"latency":"282.255µs"},"last_checked":"2026-08-08T13:04:13.100068512Z","uptime":26276241380}
```

## KMS flags
```
USE_GCP_KMS=true
PROXYHUB_REQUIRE_GCP_KMS=true
GCP_KMS_KEY_NAME_set=yes
USE_GCP_KMS_HOT=true
PROXYHUB_REQUIRE_GCP_KMS_HOT=true
GCP_KMS_HOT_KEY_NAME_set=yes
```

## Verdict

**PASS** — pass=20 fail=0 soft=0

S7_VERDICT=PASS
