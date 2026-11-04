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
- Read up to ten provider nodes, only with a provider/both/admin role.
- Check control API reachability, explicitly distinguished from a real proxy-traffic test.
- Prepare reviewed links to workflows. Opening an order, paying, cancelling, signing, publishing, or starting an audit happens in that workflow after user review.

Only allowlisted fields reach the model. No credential endpoint, wallet signer, arbitrary URL fetch, SQL, or mutation tool exists. API keys, JWTs, and known request secrets are redacted. User messages and requested account summaries are sent to the configured model service with `store: false`; the service's own data policies still apply. Do not paste secrets into chat.

All assistant requests require an explicit bearer header. Authentication checks issuer, expiry, not-before, subject, signature when `JWT_SECRET` is configured, and browser-token scope. Node/extension tokens and MFA challenges are rejected. The control API's live `/v1/auth/me` check is always required, so revocation, account status, and current role are respected. Its returned identity must match the token subject. A control API outage fails closed with HTTP 503; it never enables account access. Cookies alone cannot authorize the assistant.

Cross-origin browser requests are rejected. POST requires JSON. Request bodies are limited to 32 KB, 20 text messages, and 20,000 total characters. JSON readers cap chunked data by bytes: 16 KB for session validation and 512 KB for model/platform responses. The agent has a 90-second deadline, four tool rounds, eight tool executions, and a final answer round. Each model request has a 5,000-token output ceiling. Stop aborts the request and releases the per-account slot. Only the server constructs tool calls/results in model context; client-supplied roles are limited to user/assistant.

The in-memory limiter allows one active request and twelve requests per ten minutes per account, with a bounded account map. A process-wide ceiling limits live usage to 120 turns per ten minutes and 16 concurrent runs. This is scoped to each server process; the current production web is one container. For multiple web replicas, use a shared gateway/Redis rate limit and provider spend limits before expanding usage. This release does not store durable chat history or perform account writes.

## Security review scope

- Ownership comes from the verified bearer session, never an input user ID. Tools call only fixed caller-scoped endpoints and allowlisted query parameters. Other users' order IDs cannot be requested through an arbitrary order-detail tool.
- The model has no mutation, credential-fetch, shell, wallet-signing, arbitrary-network, or SQL tool. Prompt-injected instructions cannot grant those capabilities. Account calls return only selected fields, excluding proxy passwords, wallet/payment details, provider keys, private addresses, and contact data.
- Tool descriptions, listing titles, prior chat, and user messages are treated as untrusted content. Known credentials, common token/key formats, labelled secrets, private-key blocks, and URL credentials are redacted before model context. This does not promise to recognize every possible secret: users must keep secrets out of chat.
- Model HTML is never executed; images are not rendered; links and source cards are restricted to reviewed product destinations and safe platform record paths. No tracker or arbitrary external URL is clickable from model output.
- No shared chat store or cross-account conversation lookup exists. The root provider and lazy chat runtime are bound to the authenticated account. Identity changes synchronously reset the panel, unmount the previous chat controller, and abort its pending run before another account's UI is committed. API and stream responses use private/no-store caching and vary by Authorization.

## Verify

From `apps/web`:

```sh
npm run test:assistant
npm run typecheck
npx playwright test e2e/assistant.spec.ts --project=chromium --workers=1
```

The automated agent tests mock model responses and platform APIs, exercising actual tool execution and replay without spending model tokens. Browser tests cover account-only access, the floating launcher and bookmarked assistant URL, guide mode, streamed tools, retry/stop, keyboard submission, responsive modal/non-modal behavior, accessibility, reduced motion, unread replies, navigation/minimization persistence, and account changes. These checks run in the frontend PR workflow. A live provider smoke check can be run separately against Meta; never put model keys in fixtures, screenshots, or public reports.

Tool protocol references: [Meta Responses](https://dev.meta.ai/docs/protocols/responses), [Meta tool calling](https://dev.meta.ai/docs/tool-calling).
