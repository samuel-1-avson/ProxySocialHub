# ProxyHubb frontend rebuild — buyer journey

28 October 2026. This phase extends the approved buyer/seller workspace design with account utilities, recovery, session management, and billing. It uses the application source and real API contracts. The separate Explorer remains an independent app.

## Implemented experience

| Area | Canonical destination | Behavior |
|---|---|---|
| Wallet | `/app/wallet` | Wallet selection, signed linking, explicit disconnect/unlink, account ledger balance, linked wallet on-chain balance, and order escrow context |
| Funding | `/app/wallet?tab=funds` | Exact lamport inputs, deposit/withdrawal review, original-signature verification, signed withdrawal challenges, cooldown information, and actual server status |
| Wallet activity | `/app/wallet?tab=history` | Cursor-paginated account ledger, withdrawal status, and actual transaction links |
| Settings | `/app/settings` | Profile editing and local image preparation before save |
| Preferences | `/app/settings?tab=preferences` | Light/dark/system appearance, notification delivery matrix, digest frequency and daily hour |
| Security | `/app/settings?tab=security` | Authenticator enrollment, verification, disabling, backup-code display/replacement, and unavailable-state handling |
| Devices and security activity | `/app/settings?tab=devices`, `?tab=history` | Signed-in device revocation, revoke-all review, sign-in evidence, and reported anomaly resolution |
| Order recovery | `/app/activity/orders/[id]` | Check escrow, resume the original pending order, or request cancellation of an unfunded order |
| Purchased access | `/app/connections/[id]` | Existing authenticated order credentials, setup instructions, and extension handoff |
| Session inspection | `/app/connections/sessions/[id]` | Actual session state, live counters, reported cost, expiry, refresh and reviewed termination |
| Usage and billing | `/app/activity?tab=usage`, `?tab=billing` | Measured consumption and charges, Access Pass entitlement/quota, server-prepared payment quotes, payment verification and legacy subscription cancellation |

The primary buyer navigation stays at four destinations: Overview, Marketplace, Connections, Activity. Wallet and Settings are shared account utilities and retain the selected workspace. Legacy wallet, subscription, usage, session, identity, notification, security and device routes redirect to their consolidated destinations. Advanced account/data and API-key tools remain reachable.

## Payment and recovery decisions

Account funds, linked on-chain SOL and order escrow are separate. Selecting another balance network inspects that network; it does not silently switch the backend settlement network. Funding controls are disabled when the inspected or reported account network differs from the configured application network. New transfers verify the RPC cluster before requesting a wallet signature.

SOL amounts convert to exact integer lamports. Fractional lamports, scientific notation, unsafe JSON integers and nonpositive transfer amounts are rejected. Withdrawal authorization checks that the challenge's destination and amount match the requested linked address and exact lamports. A payout reference is not rendered as if it were a chain transaction signature.

Submitted account deposits and Access Pass payments retain their public signature before RPC confirmation, so a confirmation timeout can be recovered without another transfer. Recovery records use session storage scoped to the account wallet/user and network, with in-memory recovery when storage is disabled. No signing key or authentication secret is put in those records. Account credit and pass verification retry the original signature. A confirmed on-chain failure is distinguished from an uncertain confirmation; proven failed transfers release the pending record so a new payment can be reviewed. Manual original-signature verification remains available when returning from another session.

Resuming an order supplies its existing ID, quota and original price reference to checkout. It reads that order rather than creating another one. Escrow verification does not transfer funds. Funded cancellation rejection remains visible in the review dialog. Checkout, deposits, withdrawals and pass payment paths include immediate guards against overlapping submission. New mutation hooks disable automatic retries.

An active order, available credentials and observed traffic are distinct states. Session detail normalizes the backend's nested session/live-counter response and keeps the largest reported byte count. It directs buyers to the purchased order for public endpoint credentials instead of exposing a private session capability as a proxy password. Termination errors keep the session's reported state visible; termination alone is not presented as proof of refund or settlement.

## Security and accessibility

Authenticator QR codes are generated locally from the API's `otpauth` URI. The UI does not send setup secrets to an external chart service. An API failure is shown as unavailable rather than incorrectly claiming two-factor authentication is disabled. Device revocation, wallet unlinking, cancellation and session termination use review dialogs. Dialog title/description relationships use the shared accessible modal.

New screens share semantic light/dark tokens, table overflow regions, labeled form controls and the existing mobile navigation. The preferences screen is checked for horizontal overflow at 320px. Screenshots use fixture data and are evidence of interface behavior, not evidence of real funds or settlement.

## Verification

Validation results are recorded below after the final run. Browser fixtures and live API checks are reported separately.

| Check | Result |
|---|---|
| TypeScript and production build | Passed; 104 static pages generated |
| Focused ESLint and route contracts | Passed |
| Exact SOL and transfer recovery unit tests | 7 passed |
| Backend escrow/session/usage/earnings tests | 11 passed, no skips; separate PostgreSQL test database |
| Real local API smoke | 18 requests passed, including real Ed25519 wallet login, profile persistence, wallet/history, sessions, usage, passes and replay rejection |
| Production web/API integration | 19 requests passed through the production preview, including the protected wallet route accepting a real JWT via backend session validation |
| Buyer/browser regressions | All 19 scenarios passed: 18 in the combined run and the authenticator case in a focused rerun after fixing its accessible-image selector |

The production web preview runs at `http://127.0.0.1:4011`; its Explorer link opens the separate local app at `http://127.0.0.1:4012`. The local API runs at `127.0.0.1:18080` with PostgreSQL, password-protected Redis and NATS JetStream in a separate Compose project. Its historical migrations require Supabase authentication objects; a local-only compatibility bootstrap supplies those prerequisites without changing production migrations. Fresh secrets are generated into ignored local storage. The preview uses the existing backend session-validation path. See `scripts/ui-integration/README.md` for reproducible startup and smoke checks.

## Separate settlement integration work

Full seller → listing → funded purchase → verified traffic → earnings acceptance has **not** been completed. A separate local validator experiment reached funded escrow activation, signed provider heartbeats, published listings and actual HTTPS traffic. Work on that experiment was stopped when the user clarified the frontend priority. Its backend changes and local runtime configuration are outside the frontend release.

The frontend can be reviewed and released independently of that experiment. A future settlement acceptance run still needs to prove that observed usage produces a confirmed usage proof, payout and reconciled earnings exactly once. No public funds or production backend deployments were used for the local experiment.

## Frontend release

The buyer workspace frontend is deployed on [proxyhubb.com](https://proxyhubb.com). [GitHub Actions release run 40707255985](https://github.com/samuel-1-avson/ProxySocialHub/actions/runs/40707255985) built revision `66e7140d50fa38721f3341a4e0a5d443086b03bf`, copied the image to GCP, and completed all deployment checks. The production container and public `/app` route both returned HTTP 307 to the sign-in page when checked without a user session. After sign-in, `/app` opens the redesigned workspace. The rollout changed the web container only and retained its prior image for rollback; it did not roll the API, gateway, database, or Explorer.

The web image now builds from the repository root and includes the shared design system. The standalone runtime preserves the monorepo paths. The manual Deploy workflow has a web-only release choice and checks the installed wallet adapter's readiness during the build. The previous rollout attempts failed before reaching GCP: the first GHCR push lacked package access, and the second build caught a TypeScript error from the then-current `main` wallet reconnect code. Both were resolved before the successful third run.

## Preview evidence

- `build-screenshots/buyer-wallet.png` — account funding and network context
- `build-screenshots/buyer-session.png` — dark theme session inspection
- `build-screenshots/buyer-billing.png` — entitlements and original-payment verification
- `build-screenshots/buyer-settings.png` — consolidated preferences
