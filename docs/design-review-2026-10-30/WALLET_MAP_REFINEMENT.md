# Wallet and marketplace refinement

30 October 2026. This pass addresses the live wallet screenshot and the map inspector. The earlier passing browser suites established behavior; they were not a claim that all frontend design work was complete.

## Implemented

- The linked wallet's real on-chain balance is the primary value. Account funds and order records are secondary and clearly separate. A zero account balance does not imply an empty linked wallet.
- Connection guidance distinguishes a saved address, a connected matching wallet, a different connected wallet, and an unlinked account. The primary connect action is styled visibly and appears before address management.
- Copy-address feedback, a manual balance refresh, periodic on-chain refresh, an observed update time, and an explicit RPC-failure state use the existing real API/RPC clients. Unavailable balances never become zero.
- Seller wallet navigation points to earnings and payout review. Buyer guidance explains the actual order-escrow flow without asking for an unnecessary account deposit.
- Marketplace filters collapse when an offer is selected. On desktop the map stays visible beside the inspector; mobile uses a single column. Selection is derived from the current API record and clears on filter changes instead of being reset by synchronization effects. This also removes the three prior map-page effect lint errors.

The existing signature, amount, network-mismatch, withdrawal review, and pending-transfer recovery controls remain in place. Browser fixture values are confined to tests and are not production balances or funded-acceptance evidence.

## Validation

Web TypeScript and focused ESLint pass. The production build passes. Seventeen buyer/map browser cases passed, followed by four final layout/error cases after the primary-button refinement, for eighteen unique scenarios. Checks include a funded linked wallet with zero account funds, real clipboard contents, RPC refresh/error behavior, 320px layout, sticky map visibility, and clearing a deep-linked selection when filters change. No test retries or skips were used.

## Remaining frontend work

| Priority | Work | Acceptance boundary |
| --- | --- | --- |
| High | Provider onboarding and recovery | Approval, credential saving, authenticated tunnel and actual heartbeat must all succeed; browser approval alone is insufficient. A separate provider fix addresses the production empty-IP insert failure found in this run. |
| High | Availability and geographic data | Correct authoritative source records, expose observation time and actual tunnel evidence, and reconcile Explorer inventory with gateway availability. Keep unknown values truthful. |
| Medium | Advanced seller and catalog screens | Migrate catalog editing, pools, customers and service configuration into the same interaction patterns while retaining useful access. |
| Medium | Support and communication | Configure a real support-submission destination and review inbox/forum empty, error, mobile and focus states. Never show a fabricated submission success. |
| Medium | Cross-surface consistency | Review remaining legacy utilities, Explorer detail states, table density, terminology and reciprocal links against the shared themes and workspace navigation. |

The funded purchase → routed traffic → settlement → earnings acceptance remains separate from these UI tests. The isolated buyer now has 5 devnet SOL. Its key is not embedded in the frontend or exported. The user's linked wallet is a separate address and was observed with 15 devnet SOL in the live interface.
