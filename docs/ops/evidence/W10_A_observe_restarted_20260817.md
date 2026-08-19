# Evidence: W10.A observe clock restarted — 2026-08-17

## Verdict

**RESTARTED** — not a decision record.

Host-A control-api was rolled 2026-08-17
([`HOST_A_CONTROL_API_ROLL_20260817.md`](HOST_A_CONTROL_API_ROLL_20260817.md)).
That swaps the binary under the soak fleet, so the 2026-08-14 → 08-21
calendar no longer applies.

| | Value |
|-|-------|
| Mode | still `observe` (not flipped) |
| New clock start | 2026-08-17 |
| ≥7 days due | **2026-08-24** |
| Week-1 kill-API | 2026-08-14, **other binary** — do not reuse |
| Next kill-API | this roll’s image |
| Decision | still unwritten (stay observe / enforce / revert) |

HMAC still admits CONNECT. `remaining_spof=control_api_hmac_and_redis`.
Issuer honesty is now `operators_and_control_api` because the bundle pin
is on this binary. That is not operator-minted capabilities.

Not DePIN. Not enforce.
