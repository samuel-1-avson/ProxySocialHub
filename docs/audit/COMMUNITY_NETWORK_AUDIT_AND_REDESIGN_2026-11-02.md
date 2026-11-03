# ProxyHubb Community & network: audit and redesign report

**Date:** 2 November 2026 (Africa/Accra)  
**Repository revision reviewed:** `dc5a01ad`  
**Deliverable:** Product, experience, technical and trust audit; proposed redesign and implementation backlog. No product code or records were changed.

## 1. Recommendation

Make Community & network the place where users **solve proxy problems, communicate with providers, understand network conditions, and contribute useful knowledge**.

The foundation already exists: a public forum with accepted solutions and reporting, direct messaging, profiles, follows, friendship requests, governance, and public network records. The strongest next investment is connecting and hardening those capabilities. Adding a larger social feed, more popularity metrics, or another map would increase complexity before fixing the present gaps.

Three decisions should guide the redesign:

1. **Repair privacy and messaging before expanding participation.** Raw user serialization, deleted-message handling, block enforcement and unchecked database writes need immediate attention.
2. **Organize around user tasks.** Lead with Discussions, Messages and Network status. Keep personal order Activity in the buyer workspace, referrals in settings, and detailed public records in Explorer.
3. **Build useful differentiation.** Introduce contextual troubleshooting, evidence-based provider profiles, incident subscriptions, reusable setup guides and consent-based professional connections.

The existing evergreen/chartreuse visual system is a usable base. This should be a product and interaction redesign, with targeted visual refinement, rather than a complete theme replacement.

## 2. Scope and confidence

Reviewed the workspace sidebar/header and route registries; community/forum/inbox/profile implementations; network shell and map preview; relevant Go handlers and models; social schema hardening; and existing acceptance-test sources. Visually inspected the saved 1 November forum desktop screenshot. That screenshot is historical fixture evidence, not a new production observation.

**Validation performed:**

- Ran `node scripts/validate-routes.mjs` from `apps/web`: passed, validating 95 static routes, 39 navigation keys, 106 policy entries, 11 dynamic policy prefixes and middleware guard coverage.
- Transpiled and executed the actual messaging adapter with controlled API responses. Confirmed metadata loss and preservation of newest-first message ordering; results appear in section 4.
- Inspected existing forum, messaging and frontend test coverage. Those suites were not rerun, and earlier reports' passing results are not presented as new results.
- Checked primary references for support-community patterns, accessibility and realtime security.

**Limits:** No authenticated production walkthrough, production database inspection, analytics, user interviews, load testing or comprehensive accessibility scan. Go was not available on PATH, so backend tests were not executed. Governance interaction and information architecture were considered; token economics, voting contracts and network infrastructure were outside this focused audit. No usage, revenue, engagement or performance numbers have been invented.

Findings below distinguish **confirmed source behavior**, **reproduced adapter behavior**, **production impact requiring verification**, and **proposed improvements**. Priority indicates recommended action order, not proof of an exploited incident.

## 3. Current capability inventory

| Surface | What exists in this checkout | Assessment and direction |
|---|---|---|
| Workspace Community & network | Sidebar exposes Forum, Activity feed and Governance. Header search also lists the old feed. | Navigation has drifted from the current product. Replace the archived entry and align canonical routes. [E01–E03] |
| Forum | Public categories, search, recent/popular/unanswered views, personal posts, composer, nested replies, votes, accepted solutions, reporting and moderator endpoints. | Retain and improve. Accepted answers and reporting are existing capabilities, not new features to rebuild. [E04–E07] |
| Social activity feed | `/community/feed` permanently redirects to an archive explaining that it is no longer a primary destination. | Keep retired. Repair remaining promotional links. [E03] |
| Messages | Canonical `/messages` reuses the community inbox; conversation search, intentional first messages, mobile list/thread views, realtime subscriptions, duplicate-event protection and failed-send draft retention exist. | Valuable, but incomplete API integration affects privacy, history, read state and recovery. [E08–E11] |
| Profiles and relationships | Public profiles, follows, blocks, reviews, friendship requests and suggested people exist. | Evolve into useful professional relationships. Enforce relationship rules across APIs. [E12–E13] |
| Referrals | Redirects to `/app/settings?tab=referrals`. | Keep as an account growth tool; do not recreate a standalone community destination. [E03] |
| Beta program | Archived; not accepting new task submissions on the archive page. | Keep out of primary navigation. Any future research program needs a specific operating purpose. [E03] |
| `/network` | Feature-gated map preview and activity/governance rail; redirects to marketplace map when disabled. | It is currently another discovery entry, not a complete network status product. Reuse its components selectively. [E14–E16] |
| Explorer | Dedicated public-record destination outside the main workspace host. | Keep detailed network evidence there; link from understandable status summaries. [E02] |
| Governance | Proposal experience and execution-readiness banner exist. | Preserve actual participation and honest readiness states; make entry prominence depend on meaningful decisions. Do not label the whole capability unimplemented. [E17] |
| Legacy globe/mining concepts | Legacy globe flags return false; DePIN portal presents supported destinations and explicit limitations. | Keep theatrical globe/mining/reward claims out of the core community experience. [E14, E18] |

### What is already worth preserving

The current forum is readable, provides a clear posting action and search, and separates categories from discussions. Existing screens distinguish many loading, failure and empty states. The inbox already avoids automatic greeting sends and disables automatic mutation retries. Public browsing does not need a wallet-signing ceremony. Moderation and schema indexes exist. Preserve these improvements while fixing the gaps below.

The saved desktop screenshot also shows generous spacing and coherent brand colors. However, category cards and guidance occupy substantial space before the discussion list, while votes receive strong visual emphasis. A task-focused layout can expose answers and unresolved questions sooner.

## 4. Findings and required remedies

**P0:** investigate and contain before broader rollout. **P1:** repair before shipping the redesigned core flows. **P2:** complete during redesign or the following improvement phase.

### F01 — P0: public forum responses can serialize private user fields

**Confirmed source path; live disclosure not inspected.** Public forum handlers preload `Author`/`LastReplier` and serialize forum models directly. Those relations are full `models.User` objects. `User` exposes JSON fields including email, tax ID, KYC status and wallet address; its `AfterFind` hook can populate decrypted private values. This bypasses the existing `ToPublicProfile()` projection, which explicitly excludes those fields. Conversation and mutual-friend responses also contain full user relations. [E04, E09, E13, E19]

**Consequence:** when private fields are populated, a user may receive information that is intentionally absent from the dedicated public profile endpoint. Client-side normalization cannot protect the original HTTP response. This is a credible exposure path, not a claim that a production breach was observed.

**Remedy:** introduce explicit, minimal public user summaries at every community response boundary; never serialize persistence models directly. Use selected columns where practical and avoid private-field decryption on public reads. Cover forum author/last replier, posts, inbox previews/senders and mutual friends. Verify an anonymous forum response with a synthetic account containing private values. Review relevant cache exposure if production reproduction confirms the issue.

**Acceptance:** forbidden field names and values are absent from anonymous forum payloads and other users' social responses, including nested relations.

### F02 — P1: block records do not prevent messaging or friend requests

**Confirmed handler gap.** Profile blocking records a block and removes follows. The inspected `startConversation`, `sendMessage` and `sendFriendRequest` handlers do not check either direction of the block relationship. Suggested people exclude friends and pending requests but not blocked users. [E09, E12–E13]

**Consequence:** the platform has a block control without consistent communication protection. The profile confirmation currently describes removing follows; the redesigned meaning must be explicit.

**Remedy:** create one server-side interaction policy used for new conversations, subsequent sends, friend requests, recommendations and notifications. Blocking should stop new social contact and remove suggestions. Preserve access to existing order/dispute evidence through a separate support path, with clear user-facing behavior.

**Acceptance:** after either party blocks, direct API calls cannot send messages or requests; no new related notification or realtime delivery is emitted. Historical evidence remains available under defined permissions.

### F03 — P1: deleted-message content can still appear; edit/reply metadata is lost

**Reproduced with the actual active adapter.** `mapApiMessage()` keeps ID, content, read time and creation time, but drops `is_deleted`, `edited_at`, `reply_to_id`, type and reactions. The inbox checks `message.is_deleted` to choose a tombstone. The API soft-delete only marks a boolean, while history/last-message queries can still return the original content. [E08–E11]

Diagnostic result with a deleted, edited reply:

```text
deletedFlagPreserved: false
editedFlagPreserved: false
replyTargetPreserved: false
originalDeletedContentRetained: true
```

**Remedy:** preserve typed lifecycle fields and return a content-free tombstone from ordinary read/search/preview APIs for deleted messages. Invalidate or update affected caches across devices; emit edit/delete events. Any retained moderation evidence needs restricted access and an explicit retention policy.

**Acceptance:** deletion removes original text from history, previews, normal search, reconnect responses and notifications where controllable. Editing consistently shows its status after refetch.

### F04 — P1: inbox history, order, unread state and reconnect recovery are incomplete

**Confirmed integration gaps; ordering reproduced.** The API returns messages newest first and defaults to 50, while the adapter preserves that order and the thread renders it directly, then appends new messages at the bottom. The controlled response `[newer, older]` remained `[newer, older]`. Conversation listing defaults to 20. The client drops paging metadata and offers no older-history/list continuation. The thread does not call the existing read endpoint. When realtime disconnects, conversation previews poll, but the open thread has no corresponding polling/catch-up path. [E08–E11]

**Remedy:** use a documented chronological display order with a stable ID tie-breaker, cursor-based history and conversation pagination, server-backed search, and a read watermark acknowledged only after visible messages are rendered. Reconnect should fetch missed messages and reconcile IDs. Preserve scroll position while loading older content; scroll automatically only when the reader is already near the bottom.

**Acceptance:** verify 21+ conversations, 51+ messages, equal timestamps, message receipt while offline, multiple devices and a reader reviewing older messages. Read counts converge without marking unseen arrivals read.

### F05 — P1: messaging can return success after failed writes

**Confirmed source behavior.** Several `tx.Create`, timestamp updates and `Commit` results are unchecked in `startConversation` and `sendMessage`. The normal send path then emits realtime/notification side effects and returns success. First-message paths also bypass the masking and recipient notification behavior used by subsequent sends. [E09]

**Remedy:** use one checked transactional message-creation service for initial and later messages. Apply the same validation, privacy policy and recipient rules. Add client-generated idempotency keys with a uniqueness constraint. Trigger delivery only after successful commit; use a transactional outbox for reliable eventual delivery.

**Acceptance:** injected insert/update/commit failures return failure and emit no delivery; retrying an ambiguous request with the same key creates one message. First messages notify recipients through the same durable mechanism.

### F06 — P1: “Message” from a profile does not preselect its recipient

**Confirmed parameter mismatch.** `ProfileView` links to `/messages?to=<id>`, but the inbox initializes recipients only from `recipient` or `user`. [E08, E12]

**Remedy:** choose `recipient` as the canonical parameter, support old aliases during transition, and centralize link generation. Apply the same contract to listings and friend cards.

**Acceptance:** clicking a profile's Message action opens the correct recipient composer, sends nothing automatically, and preserves the intended destination through authentication.

### F07 — P1: long forum discussions can hide subsequent replies

**Confirmed source behavior.** The backend returns a default page of 20 posts, including pagination metadata. The active `getThread()` type and thread screen expose only the first posts array and no continuation. A separate paginated `getThreadPosts()` client already exists. Forum search and recent/popular collections similarly have limited first-result views; recent/popular handlers return a capped list without a page offset. [E04–E07]

**Remedy:** connect thread pagination to the existing posts endpoint; add proper list/search continuation and stable sort keys. Fetch/display the accepted solution independently if it lies outside the loaded page. Nested replies must preserve parent context across page boundaries.

**Acceptance:** a 25-reply discussion exposes all replies and its accepted answer; large categories/search results can be traversed without duplicates or omissions.

### F08 — P2: current navigation promotes an archive and loses active state

**Confirmed source behavior.** Sidebar/header hardcode `/community/feed`, which redirects to the retirement notice. The sidebar marks Forum active only under `/community/forum`, even though those URLs redirect to canonical `/help/forum` paths. The separate route registry already knows the new destinations, but the current sidebar does not use it. `/friends` does have a redirect, so it should not be reported as a missing route. [E01–E03]

**Remedy:** share one destination configuration across sidebar, mobile navigation, header search and footer. Remove the archived feed from active navigation, use canonical forum links, and test active states after redirects. Distinguish workspace Activity from community content.

**Acceptance:** all navigation surfaces agree; forum/category/thread pages have the expected active state; no primary action lands on an archive. Passing route-existence validation alone is insufficient.

### F09 — P2: the network rail labels one-time, fallible data as live

**Confirmed source behavior.** `ActivityRail` loads once, labels the section “Live feed”, converts failed feed/governance requests to empty arrays, and links “Full feed” to the archived route. Its feed source requires authentication, while `/network` is public. The older `subscribeToFeed()` helper starts an empty timer and never delivers an event. Actual production visibility of `/network` depends on the feature flag. [E14–E16, E20]

**Remedy:** replace the rail with public, explicitly scoped network updates and real freshness metadata. Show source failure, sign-in requirement, stale data and genuine inactivity separately. Implement polling/realtime with recovery where promised, or label the content “Recent updates”. Remove the empty subscription implementation after tracing its callers.

**Acceptance:** anonymous use, expired authentication, source outage, no activity and stale snapshots all produce truthful distinct states. No “live” label without a maintained update mechanism.

### F10 — P2: recommendations favor popularity and add per-person queries

**Confirmed source behavior.** Suggested people are selected by follower count/newness, then mutual counts are computed inside a loop. The computed mutual score does not reorder that initial selection. This is a bounded N+1 query pattern, not evidence of measured production slowness. [E13]

**Remedy:** first apply privacy/eligibility exclusions. Then use explicit interests, language, provider expertise and optional region preferences, with a visible “Why suggested” explanation and dismiss control. Aggregate mutual counts in a query. Do not infer relationships from sensitive browsing or proxy destinations.

**Acceptance:** blocked accounts never appear; ranking explanations match the implemented rules; query count does not increase one-for-one with recommendation count.

### F11 — P2: accepted-solution updates need an atomic invariant

**Confirmed source behavior.** Marking a solution clears existing solution flags and sets the chosen post in separate writes; the clear operation's error is ignored. Permissions already limit the action to the author/moderator, which should be retained. [E04]

**Remedy:** perform the change in a checked transaction and enforce at most one accepted solution per thread, using an authoritative accepted-post reference or an appropriate database uniqueness constraint. Handle removal/deletion of the accepted post consistently.

**Acceptance:** concurrent acceptance attempts cannot leave multiple solutions or falsely return success after a failed update.

### F12 — P2: network summaries need explicit freshness and partial-failure handling

**Confirmed endpoint limitations.** `/v1/network/status` has useful aggregate fields and authority headers, but most aggregate query errors are unchecked. The response has no observation timestamp, sample window or coverage marker. It uses stored `is_healthy` values without an explicit freshness cutoff in this handler; upstream heartbeat maintenance was not audited. [E21]

**Remedy:** check every query and avoid converting partial source failures into credible zero values. Include `observed_at`, coverage, measurement source/window and a documented stale threshold. Verify upstream health maintenance before labeling stored health “currently online”. Separate registered, recently observed and purchasable counts.

**Acceptance:** source failure differs from zero nodes; unmeasured latency differs from 0 ms; stale records cannot silently imply current availability.

## 5. Proposed information architecture and design

### Navigation

Keep the existing **Community & network** group, with three default destinations:

| Destination | Canonical route proposal | Purpose |
|---|---|---|
| Discussions | `/help/forum` | Ask, find answers, learn and contribute. Keep existing public links. |
| Messages | `/messages` | Buyer/provider conversations and consent-based contacts; unread badge. |
| Network status | `/network` after replacement | Understand availability, incidents and regional coverage; link to marketplace and Explorer. |

Expose **People** as a secondary community tab, initially backed by `/community/friends`; use **Contacts** for accepted professional relationships. Avoid the label “Connections” here because `/app/connections` already means proxy connections. Keep the header Inbox shortcut. Governance remains reachable as a secondary item, with a contextual active-decision badge when relevant and verified readiness on the destination page. Explorer remains a public-record utility.

Do not add a separate empty community homepage at launch. Make Discussions the entry, with a small “Your community” module for watched questions, saved guides and unanswered questions in selected topics. A distinct hub becomes justified only when these modules have sufficient content.

### Desktop concept

```text
Workspace sidebar    Discussions                          Messages [unread]
                     [Search questions and guides.......] [Ask a question]
                     All | Needs help | Solved | Guides | Following

                     Relevant incident banner (only when applicable)
                     [Setup] [Buying] [Provider help] [API & SDKs]

                     Solved · SOCKS5 setup on Windows       Your community
                     Answer preview · Updated · 6 replies   Watched questions
                                                           Saved guides
                     Needs help · Region availability       Help someone
                     Context · Language · Last response     Guidelines

                     [Load more]
```

### Screen requirements

| Screen | Recommended experience |
|---|---|
| Discussion list | Compact topic chips instead of dominant category cards; readable title/preview; explicit Needs help/Solved status; latest meaningful activity; filters persisted in URL. Reduce prominence of vote/view counts. |
| Question composer | Ask / Share a guide / Report a bug templates; category-specific fields; relevant existing answers before posting; draft autosave with a clear device/privacy policy; safe code blocks; preview identical to final rendering. |
| Thread | Accepted answer summary near the question; direct answer links; contextual replies; accessible pagination; edit history policy; watch/save actions; clear reporter feedback. Separate “no replies” from “no accepted answer”. |
| Messages | Desktop list/thread layout, mobile list-to-thread transition; request inbox; block/report/mute; delivery/failure state; history loading; contextual listing/order card with authorized fields only. |
| People/profile | Separate identity verification, provider role and measured service history. Show expertise, languages and optional availability. Distinguish Follow, Save provider and Contact; explain each. Keep public wallet and private identity fields excluded. |
| Network status | Summary with timestamp and source, active incidents, country/region availability table, optional map, subscriptions and clear next steps. “Buy in this region” links to filtered marketplace; “Inspect records” opens Explorer. |
| Governance | Plain-language proposal summary, eligibility, deadline, action/decision status and execution readiness. Discussion can precede proposals; forum popularity must not masquerade as a binding vote. |

### Visual and accessibility specification

- Reuse shared surfaces, typography, semantic colors, dialogs and recovery components; reduce tiny uppercase telemetry labels and excessive decorative motion in network widgets.
- Use one obvious primary action per page, useful empty-state examples, and independent loading/error/empty/stale states per module.
- Design at 320 px, typical phone widths and desktop. On phones, stack discussion controls, use filter sheets and keep the composer visible above the keyboard. Make the regional list useful without interacting with a map.
- Target WCAG 2.2 AA: keyboard access, visible unobscured focus, contrast, meaningful names, reflow and properly managed dialogs. Use a comfortable 44 px touch-control design target; WCAG 2.2's minimum target criterion is 24 by 24 CSS px with defined exceptions, not a universal 44 px AA requirement. Honor reduced motion. See [WCAG 2.2](https://www.w3.org/TR/WCAG22/).
- Announce new messages without repeatedly announcing full history; preserve reader position. Keep status understandable without color. Automated checks supplement manual keyboard, zoom and screen-reader verification.

## 6. Features to add or advance

Priorities below are proposed product sequencing, not measured demand. Validate with users before committing to the later phases.

| Feature | User benefit and practical solution | Priority / dependency |
|---|---|---|
| Contextual troubleshooting | “Get help” on an order/session creates a private case or a draft public question. Let the user review a redacted context card: client version, protocol, broad region, error code and time. Never attach credentials, destination traffic or private order details automatically. | First release after privacy repairs. |
| Better solved knowledge | Build on existing accepted answers: solved filters, prominent answer summaries, bookmarks, outdated-answer notices and maintained setup guides. Solved must identify who accepted the answer. The [official Discourse Solved pattern](https://meta.discourse.org/t/discourse-solved/30155) supports this answer-oriented approach; it is inspiration, not a recommendation to migrate platforms. | First release; fix F07/F11. |
| Safer professional inbox | Requests from unfamiliar accounts, consent rules, report/mute/block, durable delivery and contact context. Separate transactional provider support from unsolicited community contact. | First release; F01–F06. |
| Incident and coverage subscriptions | Follow selected regions/providers; receive meaningful outage, recovery or capacity changes with source/time and deduplication. Let users choose immediate critical notices or a digest. | Next release; trustworthy status data required. |
| Evidence-based provider cards | Aggregate actual service history with sample size, observation window, source, review provenance and linked public evidence. A paid tier or follower count must not imply service reliability. | Next release; measurement definitions and privacy rules. |
| Search across practical knowledge | Search public questions, answers and maintained guides with facets for topic, client, protocol and recency. Keep private support/messages in a permission-aware separate scope. | Start with forum improvements; broaden later. |
| Provider help desk workflow | Link messages to authorized order context; saved replies, private internal notes only for approved staff, case states and escalation to platform support. Do not grant provider staff general access to buyers' messages. | Next release; access model and case ownership. |
| Helpful onboarding | Choose buyer/provider/developer interests; offer a short first useful action such as finding a setup guide or asking a structured question. Follow topics by consent. | First release, small scope. |
| Maintained playbooks | Versioned guides for SOCKS5/browser/SDK setup, troubleshooting and provider deployment, with owner, last-reviewed date and tested versions. Useful answers can be promoted with author permission. | Next release; content owner required. |
| Useful expert discovery | Explainable expertise/language matching, dismiss controls and optional office hours once demand exists. Replace popularity-led suggestions. | Later; F02/F10 and enough contributors. |
| Optional answer assistant | Retrieve from approved guides and public solved questions; cite sources, disclose uncertainty and offer human escalation. Permission-check every retrieved item. Never expose private chats or run wallet/network actions. | Later experiment; evaluate wrong-answer rate, cost and usefulness first. |
| Topic spaces and research sessions | Lightweight topic collections and scheduled office hours with a named owner. Use topic tags before creating full groups. | Later, conditional on repeated demand and moderation capacity. |

### Three useful end-to-end journeys

1. **Buyer cannot connect:** Connections → Diagnose → local checks/error explanation → relevant guide → reviewed support context → provider response → confirmed resolution → optional redacted knowledge contribution.
2. **Provider experiences a regional incident:** Network status → incident detail and affected coverage → subscribe → private operational guidance → recovery update → transparent post-incident note. Individual residential node locations remain private.
3. **Developer integrates the SDK:** Search by SDK/version → maintained example → ask a version-tagged question → accepted answer → follow updates when the example changes.

## 7. Retire, merge, retain and defer

| Decision | Feature/concept | Reason and migration treatment |
|---|---|---|
| Retain retirement | Generic social feed, beta task page | Already archived. Remove remaining active entry points; preserve informative redirects and relevant account data. |
| Merge | `/network` map preview | Full discovery already lives in marketplace and detailed records in Explorer. Replace the duplicate-preview purpose with status/coverage, reusing adapters where useful. |
| Reframe | Friends and People you may know | Use Contacts and expertise-based People discovery. Preserve accepted relationships and require consent for any materially different relationship meaning. |
| De-emphasize | Followers, raw votes, view counts, wholesale popularity | They can aid context but should not dominate support relevance or imply trust. Keep existing votes initially; evaluate helpfulness and solved outcomes before removing mechanics. |
| Retain with conditions | Governance | It exists and can be useful. Preserve records, readiness and eligibility; avoid making it the default path for ordinary support. |
| Keep elsewhere | Referrals, order Activity, detailed topology | Settings, buyer workspace and Explorer respectively already provide clearer homes. |
| Keep disabled | Legacy globe/mining/reward theatrics and whale-alert style social prominence | Little direct help with buying, operating or troubleshooting proxies; costly visual complexity and misleading incentives if evidence is absent. Do not remove backend records indiscriminately. |
| Consolidate | Overlapping social clients and legacy adapters | Trace consumers, define one contract per domain, migrate callers, then delete proven unused paths. The older social service also has differing response assumptions; assess callers before removal. |
| Defer | Full social groups, public chat rooms, leaderboards, tokenized posting rewards, large AI agent features | Require demonstrated user demand, moderation capacity and clear value; avoid fragmenting a small community or rewarding spam. |

Every retirement should inventory inbound links, API/SDK consumers, notification URLs, bookmarks and data obligations. Preserve canonical redirects and readable history. Instrument remaining legacy use before removing compatibility code. Nothing in this report authorizes deleting user content or conversations.

## 8. Technical approach and operating model

### Architecture

Keep the existing Next.js, Go and PostgreSQL stack for the first phases. Existing query tooling, websocket infrastructure, moderation endpoints and indexes can support the redesign without a new social platform or microservice fleet.

1. **Explicit domain contracts:** separate public identity summaries, messages, knowledge discussions, support cases and network observations. Keep persistence models behind response projections. Add contract tests at the HTTP boundary.
2. **Shared policies:** one implementation for blocks, communication eligibility, visibility, moderation permissions and notification preferences. Apply it on HTTP reads/writes and realtime delivery, rather than only in buttons.
3. **Reliable writes/events:** checked transactions, idempotency and outbox delivery; events such as `message.created`, `message.updated`, `message.deleted`, `discussion.solved` and `incident.updated` carry IDs/versions and minimal authorized data.
4. **Pagination and search:** stable cursors for frequently changing inbox/history; indexed paging for discussions. Start with PostgreSQL full-text/trigram capabilities when justified by measured search needs. Reuse existing indexes; review actual query plans before adding more.
5. **Freshness:** bounded polling with backoff as a first implementation, realtime where beneficial, visible observation times, and reconnect catch-up. Server data remains authoritative; a websocket connection alone is not proof that a screen is current.
6. **Public rendering:** evaluate server-rendering public discussion content and metadata for shareability/indexing while hydrating interactive actions separately. Private messages and support contexts must never enter public page caches or search indexes.

Proposed incremental schema additions: a message idempotency key/read watermark; authoritative accepted-answer reference or invariant; topic subscriptions/bookmarks; support cases with scoped references; incident status/updates/subscriptions. Reuse existing block, report, notification and relationship tables. Specify retention/export/deletion behavior before adding attachments or private-case storage.

### Trust and moderation

Extend existing moderator/reporting infrastructure rather than replacing it. Add a report receipt and status explanation, moderator assignment, reasoned actions, appeals appropriate to the action, and audit history with restricted evidence access. Staff and providers need visibly distinct roles. Keep internal identity checks separate from public reputation.

Introduce account-based write limits, bounded payload lengths and graduated friction for suspicious contact. The inspected messaging route registration has no route-specific rate-limit middleware; audit any shared/upstream protection before claiming that the deployment has none. A regex mask is not secret detection: warn before posting likely credentials and provide a reviewable redaction preview. First and later messages must follow the same policy.

For realtime expansion, test origin validation, session expiry, per-action authorization, payload limits and abuse throttling as recommended by the [OWASP WebSocket Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html). This is a hardening requirement, not a finding that every listed protection is currently missing.

Assign a product/content owner for guides and unanswered questions, an engineering owner for contracts and delivery, and a moderation/support owner for reports and incidents. An advanced community needs an operating team and content maintenance as well as screens.

## 9. Phased implementation backlog

These are ordered work packages, not delivery-date or staffing estimates. Complete each gate before expanding exposure.

| Phase | Work package | Exit gate |
|---|---|---|
| 0 — Trust and correctness | F01–F07: public DTOs, deleted-content projection, blocks, checked message writes, inbox history/order/read/recovery, recipient links, long forum threads. | Privacy/authorization regression cases pass; synthetic failures never produce false send success; full histories remain accessible. |
| 1 — Coherent core experience | Canonical navigation, Discussions/Messages/Network status structure, solved indicators, better composer, accessible responsive layouts, onboarding and report feedback. | Buyer/provider/anonymous task walkthroughs pass; no active links promote archives; essential tasks work on mobile and keyboard. |
| 2 — Practical differentiation | Contextual diagnostics, provider help workflow, maintained playbooks, trustworthy incident/coverage subscriptions and evidence-based provider summaries. | Permission tests for every context card; real owners and data sources; notification usefulness assessed against opt-outs. |
| 3 — Demand-led expansion | Expert matching, topic spaces, office hours and an optional sourced assistant. | User research and observed demand justify each feature; moderation/accuracy/cost gates met before general release. |

**Smallest worthwhile redesign release:** fix trust/reliability, remove the archived feed entry, use canonical Discussions links, repair profile-to-message, expose accepted answers/history properly, and deliver a simple timestamped status/list view. Ship these as small vertical changes, not one large rewrite.

Suggested first implementation tickets:

1. Public social-response DTOs with forbidden-field regression fixtures.
2. Shared block/contact policy with direct HTTP and delivery tests.
3. Message lifecycle contract, content-free tombstones and cache/event updates.
4. Checked transactional sends and idempotency, including the initial message.
5. Inbox history/order/read/reconnect and deep links outside the first 20 conversations.
6. Forum continuation, independently accessible accepted answer and atomic solution update.
7. Shared canonical community navigation across desktop/mobile/search/footer.
8. Network rail replacement with honest status and freshness states.

## 10. Measurement, acceptance and research

### Product measures

Use **resolved user problems and successful continued platform use** as the primary outcome. Establish a baseline before assigning numeric targets.

| Measure | Definition / practical use |
|---|---|
| Resolution rate | Eligible support questions with an author/moderator-confirmed solution; report by cohort and time window, including reopened cases. |
| Time to useful response | Median and upper percentile to a substantive response; exclude automated greetings. |
| Self-service usefulness | Explicit helpful feedback on guides/answers and subsequent task completion; do not treat every search exit as successful deflection. |
| Conversation reliability | Durable successful writes, duplicate-message rate, reconnect recovery and unread convergence. |
| Provider support quality | Response/resolution time with sample size and availability context; avoid simplistic public rankings. |
| Trust and safety | Confirmed block-policy failures, substantiated spam rate, report handling time and appeal outcomes. |
| Network usefulness | Status freshness, incident-notice opt-in/opt-out, recovery-notice usefulness and successful region discovery. |

Track minimal events such as `community.search`, `discussion.created`, `solution.accepted`, `message.send_result`, `report.submitted` and `incident.subscription_changed`. Collect IDs, timing and coarse categories; do not put message bodies, credentials, precise node locations or proxy destinations into analytics.

### Required acceptance scenarios

- Anonymous forum response contains no private identity values, including nested authors and last repliers.
- A nonparticipant cannot retrieve, search, edit, react to or receive another conversation through HTTP/realtime.
- Blocking is enforced in both directions for new contact, suggestions and delivery.
- Deleted content stays absent after refresh, preview/search retrieval and reconnect; edits converge across devices.
- Failed database commit emits no successful response/delivery; repeated idempotent sends create one record.
- The 21st conversation, 51st message and 25th forum reply are reachable; direct links to older conversations work.
- Profile/listing message actions select the right recipient and never send an unsolicited greeting.
- Disconnect/reconnect restores missed open-thread content without duplicates or lost scroll position.
- Concurrent solution changes preserve one accepted answer; the answer is reachable beyond the first reply page.
- Retired URLs remain informative, while active navigation highlights canonical pages correctly.
- Network source failure, stale data, no data and healthy measurements remain distinguishable.
- Keyboard, screen-reader, 200% zoom and narrow-screen checks cover posting, reporting, pagination and messaging; no wallet connection is required merely to read public knowledge.

Use the existing test suites as a foundation. Add these missing failure, privacy and multi-page cases instead of duplicating already-covered happy paths. The current route validator passed but cannot catch archived-link usefulness, recipient-parameter contracts or all responsive active-state defects.

### Research before later feature commitments

Interview a small, balanced set of buyers, providers and developers. Ask them to find a setup answer, contact a provider, diagnose an unavailable region, report abuse and explain the difference between Activity, Contacts and proxy Connections. Include new users and people using narrow screens or assistive technology. Observe task completion and vocabulary; do not ask only whether they like the new design.

Validate assumptions about demand for direct contacts, regional updates and expert help before expanding the social graph. Assign an owner to initial guides and unresolved questions so a redesigned community has useful content on launch.

## Evidence index

Repository links are relative to this report. Line anchors identify the reviewed revision and can move as implementation changes.

| ID | Source and relevant location |
|---|---|
| E01 | [Workspace sidebar](../../apps/web/src/components/Sidebar.tsx#L44): current group, hardcoded feed/forum URLs and active-state checks. |
| E02 | [Workspace header](../../apps/web/src/components/workspace/WorkspaceHeader.tsx#L62), [workspace navigation](../../apps/web/src/lib/navigation/workspace.ts#L17), [route registry](../../apps/web/src/lib/navigation/routes.ts#L65): duplicate destination definitions and canonical paths. |
| E03 | [Redirect configuration](../../apps/web/next.config.ts#L161), [feed redirect](../../apps/web/src/app/community/feed/page.tsx), [archive content](../../apps/web/src/app/help/community/archive/%5Bsection%5D/page.tsx), [referrals redirect](../../apps/web/src/app/community/referrals/page.tsx), [beta redirect](../../apps/web/src/app/community/beta/page.tsx). |
| E04 | [Forum API](../../services/control-api/internal/api/forum.go#L17): public/protected routes; public preloads around lines 126–250; solution writes at 550; search at 817. [Public route registration](../../services/control-api/main.go#L598). |
| E05 | [Forum home](../../apps/web/src/app/community/forum/page.tsx), [collection](../../apps/web/src/components/community/ForumThreadCollection.tsx#L39), [card](../../apps/web/src/components/community/ForumThreadCard.tsx): current list, capped collection and status presentation. |
| E06 | [Thread screen](../../apps/web/src/app/community/forum/thread/%5Bid%5D/page.tsx#L40), [composer](../../apps/web/src/app/community/forum/new/page.tsx), [forum client](../../apps/web/src/lib/forum-api.ts#L114): current posts loading, existing pagination client and interaction capabilities. |
| E07 | [Forum moderation API](../../services/control-api/internal/api/admin_forum_moderation.go#L19), [forum tests](../../services/control-api/internal/api/forum_test.go): existing moderation and test foundations. |
| E08 | [Inbox screen](../../apps/web/src/app/community/messages/page.tsx#L56): recipient parameters, conversation query, realtime listener and thread behavior at 278. [Canonical messages entry](../../apps/web/src/app/messages/page.tsx). |
| E09 | [Messaging API](../../services/control-api/internal/api/messaging.go#L16): conversation listing, initial sends at 134, history order at 249, sends at 265, read at 356, edit/delete and search. |
| E10 | [Messaging adapter](../../apps/web/src/lib/messaging/social-messaging.ts#L45): field projection and normalized reads; [underlying social client](../../apps/web/src/lib/api/social.ts#L170): metadata discarded from list/history responses. |
| E11 | [Messaging models](../../services/control-api/internal/models/messaging.go), [messaging tests](../../services/control-api/internal/api/messaging_test.go), [frontend recovery tests](../../apps/web/e2e/frontend-message-recovery.spec.ts), [completion tests](../../apps/web/e2e/frontend-completion.spec.ts#L231). |
| E12 | [Profile view](../../apps/web/src/components/ProfileView.tsx#L196): `to` parameter; [profile API](../../services/control-api/internal/api/profile.go#L484): block implementation. |
| E13 | [Friends API](../../services/control-api/internal/api/friends.go#L51): requests, suggestions at 456 and mutual friends at 527; [friends screen](../../apps/web/src/app/community/friends/page.tsx); [suggestion component](../../apps/web/src/components/PeopleYouMayKnow.tsx). |
| E14 | [Network entry](../../apps/web/src/app/network/page.tsx), [feature flags](../../apps/web/src/lib/feature-flags.ts#L10): feature gate and disabled legacy globe flags. |
| E15 | [Network shell](../../apps/web/src/components/network/NetworkShell.tsx), [map embed](../../apps/web/src/components/network/NetworkMapEmbed.tsx): preview purpose, map links and presentation. |
| E16 | [Activity rail](../../apps/web/src/components/network/ActivityRail.tsx#L15): one-time fetch, swallowed failures and archived feed link; [feed API](../../services/control-api/internal/api/feed.go#L25): authentication requirement. |
| E17 | [Governance page](../../apps/web/src/app/governance/page.tsx), [execution-readiness banner](../../apps/web/src/components/governance/GovernanceExecutionBanner.tsx). |
| E18 | [DePIN portal](../../apps/web/src/components/network/DePINPortal.tsx): supported destinations, acceptance status and disabled reward/mining operations. |
| E19 | [User model](../../services/control-api/internal/models/user.go#L47), including private-field JSON tags and `AfterFind` at 154; [forum model relations](../../services/control-api/internal/models/forum.go#L80); [safe public profile projection](../../services/control-api/internal/models/profile.go#L92). |
| E20 | [Legacy feed subscription](../../apps/web/src/lib/services/feed.ts#L12): empty interval; [older social service](../../apps/web/src/lib/services/social.ts): overlapping client surface requiring caller review. |
| E21 | [Network status API](../../services/control-api/internal/api/network.go#L35), [network tests](../../services/control-api/internal/api/network_test.go), [social indexes](../../migrations/000090_network_social_schema_hardening.up.sql). |
| E22 | [Previous frontend completion report](FRONTEND_COMPLETION_REPORT_2026-11-01.md), [inspected historical screenshot](previews/2026-11-01/forum-desktop.png), [route validator](../../apps/web/scripts/validate-routes.mjs), [network test source](../../apps/web/e2e/network-unified.spec.ts). |

**Implementation starting point:** prioritize F01–F07 and the smallest worthwhile release in section 9. The later feature proposals are a roadmap for validation, not a requirement to build every idea.
