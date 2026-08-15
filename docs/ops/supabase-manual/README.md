# Archived control-api / Supabase manual SQL

These scripts were formerly under `services/control-api/migrations/` and are **not**
applied by `RunMigrations`. Unique DDL has been promoted into root numbered
migrations (`000119`–`000122`). RLS scripts remain manual ops artifacts only.

| File | Notes |
|------|--------|
| `20260121_*_rls*.sql` | Supabase RLS playbooks — do not auto-apply on service-role API |
| `20260121_soft_deletes_partitioning.sql` | Historical soft-delete / audit partition helper |
| `20260121_database_improvements.sql` | `encrypted_credentials` → `000119` |
| `20260121_proxy_engine.sql` | proxy-engine tables → `000120` (without RLS) |
| `20260330_cascade_deletes.sql` | CASCADE + dedup → `000122` |
| `20260401_l2_phase4_zk_batch.up.sql` | `zk_batches` → `000121` |

See [`migrations/README.md`](../../migrations/README.md).
