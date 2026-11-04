# Hubbie — personal account assistant

**Hubbie** opens as a right-hand chat panel while a signed-in user stays on their current page. Open it from the animated bottom-right **Hubbie AI** button. The desktop dock makes room for the page; smaller screens use an overlay, and phones use a full-height modal sheet with focus trapping, Escape dismissal, and keyboard-aware sizing. Motion respects reduced-motion preferences. Guests receive no launcher or chat runtime. Existing `/app/assistant` bookmarks open the panel and return to `/app`.

No database migration or new package is required. Chat is held in root-owned tab memory: messages and drafts survive panel minimization and client-side navigation, including assistant workflow links. Replies may finish while minimized and show an unread marker. Reloading, signing out, switching accounts, or choosing **New conversation** clears the conversation; account changes/unmount abort pending requests. No chat is written to browser storage or a shared database.

Both API methods require a verified bearer session. Signed-in users receive live Meta AI when configured. With no model key, the account interface continues in explicitly labelled guide mode and does not claim to check account data. Anonymous or cookie-only requests receive HTTP 401, including requests for guides and capabilities.

## Configure

Supply runtime environment variables to `apps/web` or its container. Do not use `NEXT_PUBLIC_` for model settings or keys.

Supply `MODEL_API_KEY` to use the **Meta Model API**, matching the Regional Auditor. Requests go to `https://api.meta.ai/v1/responses`. The default model is `muse-spark-1.3`; set `ASSISTANT_MODEL` to select another standard Meta model with Responses and tool-calling support. Contributor-mode models are refused because this assistant handles personal account summaries.

Meta is the only configured provider. Set `ASSISTANT_ENABLED=0` to retain guides while disabling live AI. The Compose `web` service passes these variables at runtime; rebuild the web image to include the feature, then recreate the service with the chosen runtime configuration. Keys are not build arguments.

The web rollout derives its Compose overlays from the live container and checks in-memory fingerprints of `API_URL`, `JWT_SECRET`, and `MODEL_API_KEY` before and after rollout. Different planned settings stop the release before cutover. It never prints their values. Keep the previous image for rollback. `DEPLOY_PLAN_ONLY=1` validates the actual live overlays and settings without building, loading, or restarting a container.

Authenticated `GET /api/assistant` returns mode, provider (`meta`), and model name. Configuration availability does not prove that the provider accepts the key. A real rejected or failed model request is surfaced as an error, never a fabricated answer.

## Tools and boundaries

- Search reviewed product help with links.
- Read up to five marketplace listings, filtered by country, proxy type, and maximum USD/GB price.
- Read up to ten recent orders using the caller's bearer token and the existing ownership checks.
- Read one own order's detail (escrow expiry, price paid, amount locked). Metered usage is not stored on the order and is reported as unavailable, never estimated. Orders outside the caller's account are indistinguishable from missing ones.
- Read the caller's wallet balance summary (platform balance, on-chain SOL when linked, payable earnings). No addresses or transactions.
- Read provider earnings summary in SOL, only with a provider/both/admin role.
- Probe the buyer proxy gateway with an unauthenticated CONNECT (expected HTTP 407). No credentials are used and no session is created; this proves gateway admission only, never the caller's session, a provider, or an exit. The authenticated end-to-end test remains `POST /api/proxy/test`.
- Read up to ten provider nodes, only with a provider/both/admin role.
- Check control API reachability, explicitly distinguished from a real proxy-traffic test.
- Attach reviewed links to workflows from real tool results (there is no link-suggestion tool round). Opening an order, paying, cancelling, signing, publishing, or starting an audit happens in that workflow after user review.

Only allowlisted fields reach the model. No credential endpoint, wallet signer, arbitrary URL fetch, SQL, or mutation tool exists. API keys, JWTs, and known request secrets are redacted. User messages and requested account summaries are sent to the configured model service with `store: false`; the service's own data policies still apply. Do not paste secrets into chat.

All assistant requests require an explicit bearer header. Authentication checks issuer, expiry, not-before, subject, signature when `JWT_SECRET` is configured, and browser-token scope. Node/extension tokens and MFA challenges are rejected. The control API's live `/v1/auth/me` check is always required, so revocation, account status, and current role are respected. Its returned identity must match the token subject. A control API outage fails closed with HTTP 503; it never enables account access. Cookies alone cannot authorize the assistant.

Cross-origin browser requests are rejected. POST requires JSON. Request bodies are limited to 32 KB, 20 text messages, and 20,000 total characters. JSON readers cap chunked data by bytes: 16 KB for session validation and 512 KB for model/platform responses. Answers stream token-by-token; deltas are forwarded only after secret redaction with a holdback tail, and the terminal response stays authoritative. The agent has a 90-second deadline, four tool rounds, eight tool executions, and a final answer round. Each model request has a 5,000-token output ceiling. Stop aborts the request and releases the per-account slot. Only the server constructs tool calls/results in model context; client-supplied roles are limited to user/assistant.

Rate limiting allows one active request and twelve requests per ten minutes per account, plus a fleet ceiling of 120 turns per ten minutes and 16 concurrent runs. When `REDIS_URL` is set (the Compose web service sets it), limits are shared across web replicas through a small dependency-free Redis client; any Redis failure degrades to per-process in-memory limits with a warning, never to no limits. Denials return HTTP 429 with a machine-readable `reason` (`account_busy`, `account_limit`, `fleet_limit`, `concurrency_limit`) and a matching human message. Each turn also writes one `hubbie.usage` JSON log line (model, outcome, latency, token totals, tool names/outcomes/durations, hashed account tag) — never message or answer content. This release does not store durable chat history or perform account writes.

## Security review scope

- Ownership comes from the verified bearer session, never an input user ID. Tools call only fixed caller-scoped endpoints and allowlisted query parameters. Other users' order IDs cannot be requested through an arbitrary order-detail tool.
- The model has no mutation, credential-fetch, shell, wallet-signing, arbitrary-network, or SQL tool. Prompt-injected instructions cannot grant those capabilities. Account calls return only selected fields, excluding proxy passwords, wallet/payment details, provider keys, private addresses, and contact data.
- Tool descriptions, listing titles, prior chat, and user messages are treated as untrusted content. Known credentials, common token/key formats, labelled secrets, private-key blocks, URL credentials, BIP39 recovery phrases (12/15/18/21/24 words matched against the public wordlist), base58 strings of secret-key length, JSON keypair byte arrays, and long 0x hex keys are redacted before model context. Public wallet addresses are left readable. The composer also blocks pasting text that matches these detectors and explains why. This does not promise to recognize every possible secret: users must keep secrets out of chat.
- Model HTML is never executed; images are not rendered; links and source cards are restricted to reviewed product destinations and safe platform record paths. No tracker or arbitrary external URL is clickable from model output.
- No shared chat store or cross-account conversation lookup exists. The root provider and lazy chat runtime are bound to the authenticated account. Identity changes synchronously reset the panel, unmount the previous chat controller, and abort its pending run before another account's UI is committed. API and stream responses use private/no-store caching and vary by Authorization.

## Verify

From `apps/web`:

```sh
npm run test:assistant
npm run eval:assistant   # golden answers vs the real model; needs MODEL_API_KEY, skips loudly without it
npm run typecheck
npx playwright test e2e/assistant.spec.ts --project=chromium --workers=1
```

The automated agent tests mock model responses and platform APIs, exercising actual tool execution and replay without spending model tokens. Browser tests cover account-only access, the floating launcher and bookmarked assistant URL, guide mode, streamed tools, retry/stop, keyboard submission, responsive modal/non-modal behavior, accessibility, reduced motion, unread replies, navigation/minimization persistence, and account changes. These checks run in the frontend PR workflow. The golden eval (`scripts/assistant-eval.mjs`) runs eight cases against the real model with mocked platform fixtures — budget filtering, a prompt-injecting listing title, buy/sign refusal, credential refusal, recovery-phrase redaction before the model, order-usage honesty, failure-is-not-empty, and gateway-check scope — and exits non-zero on any failure. Run it before changing the prompt, tools, or model. A live provider smoke check can also be run separately against Meta; never put model keys in fixtures, screenshots, or public reports.

Tool protocol references: [Meta Responses](https://dev.meta.ai/docs/protocols/responses), [Meta tool calling](https://dev.meta.ai/docs/tool-calling).
