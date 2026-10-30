# Wallet and marketplace refinement

30 October 2026. This pass addresses the live wallet screenshot and the map inspector. The earlier passing browser suites established behavior; they were not a claim that all frontend design work was complete.

## Implemented

- The linked wallet's real on-chain balance is the primary value. Account funds and order records are secondary and clearly separate. A zero account balance does not imply an empty linked wallet.
- Connection guidance distinguishes a saved address, a connected matching wallet, a different connected wallet, and an unlinked account. The primary connect action is styled visibly and appears before address management.
- Copy-address feedback, a manual balance refresh, periodic on-chain refresh, an observed update time, and an explicit RPC-failure state use the existing real API/RPC clients. Unavailable balances never become zero.
- Seller wallet navigation points to earnings and payout review. Buyer guidance explains the actual order-escrow flow without asking for an unnecessary account deposit.
- Marketplace filters collapse when an offer is selected. On desktop the map stays visible beside the inspector; mobile uses a single column. Selection is derived from the current API record and clears on filter changes instead of being reset by synchronization effects. This also removes the three prior map-page effect lint errors.

## Automatic account funding

The funding screen now uses one focused Deposit/Withdraw form with a clear balance, amount, review step and integrated wallet connection. Users approve in their wallet; there is no transaction-signature or payment-reference input. Destination addresses and the payment network remain visible in the review. Both themes and narrow mobile layouts use the shared design system.

- Deposits retain the signed transaction identity before broadcast. HTTP checks and server verification confirm and credit the original payment automatically, including after a same-tab reload. A lost broadcast response never requests a second transfer. Unknown outcomes remain pending; an explicit chain failure or preflight rejection releases the attempt. Owner/policy errors pause automatic verification and show an account-review state.
- Withdrawals sign the server-issued amount/destination challenge through the connected wallet. A saved idempotency key precedes submission. Unknown responses resume with fresh approval and the same key. Once a payout reference is known, only its exact queue record is polled; a reload does not automatically post another withdrawal. Completed, failed and operations-review states come from the real API.
- Wrong-network, exact-lamport, available-balance, wallet-match, fee-buffer, cooldown and overlapping-submission guards remain enforced. No account credit or completed payout is fabricated while verification is pending. Pending public receipts use session storage with an in-memory fallback; keys and authorization messages are never saved there. A new browser session cannot restore a receipt that was only held in session storage; Activity remains available for server-recorded transfers.

The unused legacy deposit/withdrawal panels were removed so the routed wallet has one implementation. Access Pass and marketplace escrow remain separate flows. Browser fixture values are confined to tests and are not production balances or funded-acceptance evidence.

## Validation

Web TypeScript, focused ESLint and the production build pass. The combined buyer/workspace/map run passed 31 browser cases with no retries or skips. A separate final layout case brings this to 32 distinct scenarios, covering both themes and 320px review dialogs. Eight transfer-helper and three exact-SOL tests pass. Checks include real signing of test transactions/challenges, one broadcast after a double-click or uncertain response, same-request withdrawal recovery, chain failure, wrong genesis, altered withdrawal challenges, security holds, truthful balances, clipboard feedback and map selection/layout behavior.

The bounded live devnet deposit exposed a separate API bug: a plaintext HTTP 429 was treated as a JSON error before the configured RPC fallback could run. PR #87 fixes status classification without changing RPC configuration or weakening chain verification. Against isolated cloud PostgreSQL, 77 Solana and 31 provider-pairing cases passed without skips; the old implementation reproduced the new regression failures. The API fix is merged and deployed. The original 0.001 SOL deposit was then credited through the real API without another transfer, and replaying its verification did not credit it twice. The isolated account now has 1,000,000 real ledger lamports. Its active withdrawal security hold prevented the planned 0.0005 SOL payout; the guard was preserved. Withdrawal signing/recovery behavior passed browser tests, but live payout completion is not claimed. This is also not evidence that the broader purchase/traffic/earnings acceptance has passed.

## Remaining frontend work

| Priority | Work | Acceptance boundary |
| --- | --- | --- |
| High | Provider onboarding and recovery | Approval, credential saving, authenticated tunnel and actual heartbeat must all succeed; browser approval alone is insufficient. A separate provider fix addresses the production empty-IP insert failure found in this run. |
| High | Availability and geographic data | Correct authoritative source records, expose observation time and actual tunnel evidence, and reconcile Explorer inventory with gateway availability. Keep unknown values truthful. |
| Medium | Advanced seller and catalog screens | Migrate catalog editing, pools, customers and service configuration into the same interaction patterns while retaining useful access. |
| Medium | Support and communication | Configure a real support-submission destination and review inbox/forum empty, error, mobile and focus states. Never show a fabricated submission success. |
| Medium | Cross-surface consistency | Review remaining legacy utilities, Explorer detail states, table density, terminology and reciprocal links against the shared themes and workspace navigation. |

The funded purchase → routed traffic → settlement → earnings acceptance remains separate from these UI tests. The isolated buyer now has 5 devnet SOL. Its key is not embedded in the frontend or exported. The user's linked wallet is a separate address and was observed with 15 devnet SOL in the live interface.
