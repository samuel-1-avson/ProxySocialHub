# Evidence: W10.A wait waived — stay observe — 2026-08-19

**Superseded later the same day** by written enforce
([`W11_A_enforce_soak_20260819.md`](W11_A_enforce_soak_20260819.md)). Keep this
pack as the morning waiver only.

## Verdict

**STAY OBSERVE** (until the later enforce pack). The operator waived sitting idle until 2026-08-25.
Marketplace CONNECT remains HMAC-gated (`session_capability_mode=observe`,
`session_mint=control_api_hmac`). Capability **enforce**, operator mint as
admission, listing enforce, slash, and `programs/session` were **not**
flipped.

Work that does not change CONNECT continued the same day: W11.B org 3
([`W11_B_three_org_20260819.md`](W11_B_three_org_20260819.md)).

Host-A `control-api` was **not** recreated. `StartedAt` remains
`2026-08-18T22:19:07.846230183Z`.

## Why not enforce today

Enforce is the product flip (`remaining_spof` leaves HMAC). Waiving a
calendar is not the same as choosing enforce. Kill-API CONNECT on this image
already passed (`W10A_KILL_API_CONNECT_OK`). Enforce remains a **separate**
written call.

## Non-claims

- Not `session_mint=operator_capability`
- Not Redis-optional CONNECT as the default product
- Not DePIN
