# W2.2 — Session hydrate durability (reaper)

| Field | Value |
|-------|-------|
| Date | 2026-08-11 |
| Result | `W2_2_SESSION_HYDRATE_REAPER` |
| Redis HA | Still **not** claimed |

## What landed

1. `sessioncache.DeleteExpired` — batch delete by `expires_at` (limit capped).
2. `worker.StartSessionGatewayCacheReaper` — every 5 minutes under supervisor; wired from `StartAll`.
3. Unit test `TestDeleteExpired`.
4. HA-lite doc notes reaper + honest Redis-still-hot-path language.

## Non-claims

- Does not survive Redis wipe for keys never dual-written
- Does not replace Memorystore / Sentinel for EV-05 FIXED
- Usage metering SoT remains receipts / spill path (Sprint H), not this table
