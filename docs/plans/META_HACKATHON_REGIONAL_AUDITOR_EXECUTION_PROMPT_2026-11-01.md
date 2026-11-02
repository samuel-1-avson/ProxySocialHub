# Execution prompt: ProxyHubb Regional Auditor

You are the lead product engineer working directly in my existing ProxyHubb / ProxySocialHub repository. Implement the feature described below end to end. This is authorization to start coding, install necessary compatible dependencies, run relevant checks, and start local services. Give me a short initial update, inspect the repository, make a concise implementation plan, and immediately implement it. Continue through integration, meaningful verification, and documentation. Do not stop after a proposal, scaffold, mock UI, or an offer to continue.

## Objective and product

Build ProxyHubb Regional Auditor: an AI assistant that investigates how an authorized website behaves through different regional provider networks and produces an evidence-backed report.

The user supplies an HTTPS website, selects available regions, and describes expectations, for example: "Check that signup is usable and that the expected currency is displayed for customers in Ghana and the US."

The product obtains ProxyHubb sessions, checks the observed egress for each session, captures comparable browser evidence, uses Meta AI to interpret the evidence against those expectations, and shows regional results side by side. The user can fix their website and rerun the audit to compare results.

The target user is a small developer or QA team that cannot easily observe its website from its customers' networks. The differentiator is meaningful Meta AI reasoning grounded in actual regional network observations, with inspectable screenshots and request evidence.

An MVP needs two genuine regional exits when those resources are available, one browser/device profile, bounded read-only checks, one controlled demo website, one complete report, and a repeatable rerun. Reuse the existing marketplace, SDKs, provider network, authentication, and design system. Keep the implementation focused on this workflow.

## Workspace, timing, and authority

- Repository: C:\Users\samue\OneDrive\Desktop\projects\ProxySocialHub
- Development environment: Windows and PowerShell. Use cross-platform scripts where practical.
- Planning date: November 1, 2026, Africa/Accra timezone.
- The event page listed submission on November 4, 2026 at 9:00 PM ET, equivalent to November 5 at 02:00 in Accra. Verify the current official schedule before making submission claims. Work on the product even if this timing has changed.
- Official event: https://dev.meta.ai/events/global-hackathon
- Event details: https://cerebralvalley.ai/e/meta-ai-developer-hackathon/details
- Participation requires organizer acceptance. Do not assume I was accepted, submit anything, or accept event terms on my behalf.
- Implement locally. Public deployment, external publication, hackathon submission, paid infrastructure provisioning, wallet signatures, and transfers of funds require separate authorization.
- Make normal reversible implementation decisions autonomously. Ask only for genuinely missing external resources or product decisions that block meaningful progress, and continue independent work while waiting.

The working tree was last observed on branch codex/frontend-plan-completion, ahead by one commit, with unrelated changes in .github/workflows/deploy.yml and an untracked scripts/settlement-acceptance/ directory. Recheck current state. Preserve all pre-existing changes. Do not reset, clean, stash, overwrite, stage, or commit unrelated work. If using a new branch, use the codex/ prefix and retain the current work safely. Leave a reviewable local diff.

Never print environment contents, credentials, complete session tokens, proxy passwords, wallet keys, or raw authorization headers. Identify missing configuration by variable name only. Do not recover credentials from Git history.

## First actions and repository sources

1. Inspect Git status and applicable AGENTS.md / CLAUDE.md instructions, including parent-directory instructions.
2. Read the files below selectively; avoid reading the entire audit history or unrelated services.
3. Establish what works locally: web runtime, control API, gateway, provider sessions, regional availability, browser executable, and Meta API configuration. Record confirmed facts and missing dependencies without inventing infrastructure availability.
4. Write a short implementation checklist and start with one complete capture-to-report path. Keep the status document updated as work proceeds.

Relevant existing files, relative to the repository root:

- README.md
- apps/web/AGENTS.md
- apps/web/package.json
- docs/audit/FRONTEND_COMPLETION_REPORT_2026-11-01.md
- docs/buyer-proxy.md
- sdks/nodejs/README.md
- sdks/nodejs/index.js
- sdks/nodejs/index.d.ts
- apps/web/src/lib/api/sessions.ts
- apps/web/src/lib/api/client.ts
- apps/web/src/app/app/layout.tsx
- apps/web/src/components/AppShell.tsx
- apps/web/src/components/workspace/Patterns.tsx
- apps/web/src/lib/navigation/routes.ts
- apps/web/src/lib/navigation/nav.ts
- apps/web/src/lib/navigation/policies.ts
- apps/web/src/lib/navigation/workspace.ts
- apps/web/src/middleware.ts
- apps/web/src/app/api/proxy/test/route.ts
- services/control-api/internal/api/session.go
- services/control-api/internal/sessionintent/token.go
- services/edge-gateway/src/auth/session_intent.rs
- services/edge-gateway/src/registry/provider_selection.rs
- services/edge-gateway/src/registry/lockfree.rs
- services/provider-node/src/operator.rs

The frontend manifest currently requests Next.js 16.4.3 and React 19.2.3. Its AGENTS.md requires reading the relevant installed guides under node_modules/next/dist/docs before writing Next.js code. Inspect the installed runtime and follow those guides instead of assuming older conventions. The web development script currently serves port 4011; verify the current package scripts rather than relying on the older README port.

The completion report is historical evidence. It records frontend checks, fixture workflows, and unavailable local API behavior; it does not establish the health of the current live system. Do not present historical checks as checks you have run.

## Known gaps to address first

A. apps/web/src/app/api/proxy/test/route.ts checks the control API /health endpoint and can return "Proxy gateway is operational" without a request traversing the gateway or provider. Distinguish API reachability from confirmed proxy traffic. Preserve callers' contracts where possible. A meaningful proxy verification must use authorized session credentials and observe the target response. An anonymous health route must not imply it has tested a user session.

B. Country targeting is not necessarily strict. In provider_selection.rs, geo_matches currently accepts empty country metadata, and node selection has non-geographic fallback paths. The Go selectProviderNode helper in session.go also has a global fallback. Confirm the actual path used by the auditor before changing it.

For audits, an unavailable requested region must produce unavailable or unverified status, never a successful result silently routed through another country. Prefer the smallest compatible solution: select an appropriate authenticated/pinned session, validate its observed egress, and refuse regional interpretation if it does not meet the audit's requirement. If an opt-in strict-routing claim is necessary, propagate and validate it through the signed Go/Rust session contract and relevant SDK types. Do not trust an unsigned browser header or unexpectedly change routing behavior for all existing users.

Provider-declared country, observed public IP, and a GeoIP country estimate are different evidence sources. Display their source and timestamp. An IP lookup is an estimate of geography, not cryptographic proof of physical location. Reject mismatches; label unknown estimates honestly. Validate sticky rebinding, failover, pinned nodes, and directory selection for any paths you change.

The buyer gateway supports HTTPS through HTTP CONNECT and configured SOCKS5. It does not support ordinary absolute-URI HTTP forward proxying. Use a supported browser transport. Never fall back to a direct connection while labeling the run as proxied.

## Architecture and integration

Default to a separate Node.js/TypeScript browser worker, proposed location services/regional-auditor, using Playwright and explicit runtime dependencies. Keep long-running browser jobs out of web request handlers. Integrate ownership and authorization through the existing Go control API and existing web API patterns. Reuse current PostgreSQL and job/queue infrastructure where appropriate; avoid introducing a new broker without a clear need.

Choose the simplest maintainable job dispatch mechanism compatible with existing services. Persist job state, report metadata, and artifact references. Refreshing the results page must not lose the report. Bound concurrency and handle cancellation, worker failure, and abandoned jobs. Close browser contexts and release ephemeral resources in all exit paths. Honor existing session lifecycles; do not invent a session-revocation endpoint or bypass escrow, entitlements, metering, or funding rules.

Use an explicit, authenticated internal worker contract. Keep service credentials server-side. Protect report, screenshot, and export access with job ownership checks. Use private artifact storage or a gitignored local directory for development; do not expose the whole directory as a public static folder.

Add only the schema migrations and dependencies necessary for the feature. Do not rewrite unrelated wallet, settlement, social, governance, or agent-marketplace systems. Inspect and reuse existing conventions before deciding file names and API paths.

## Shared contracts

Define validated schemas before building the UI and runner. Adjust names to repository conventions, but preserve these concepts:

Audit job:
- ID, owner, target URL, requested regions, user expectations, browser profile, mode, schema version.
- States: queued, running, completed, partial, failed, cancelled.
- Created/started/completed timestamps, stage progress, per-region outcomes, and explicit failure reasons.
- Rerun linkage to the previous audit, with comparable expectations and browser settings.

Regional capture:
- Stable evidence ID, audit ID, requested country, provider identity/reference where authorized, provider-declared country, observed egress IP, GeoIP estimate/source/time, assurance status.
- Screenshot reference, final URL, main-document status, sanitized visible text/DOM observations, failed requests, console errors, and measured browser timings.
- Viewport, locale, timezone, and browser version so region is not confused with a different device or language configuration.
- Evidence origin: live capture, replay of a recorded live capture, or synthetic fixture. Keep this provenance attached through exports and reruns.

Finding:
- ID, related expectation, severity, affected regions, concise summary, observed versus expected result.
- Existing evidence IDs, relevant screenshot/DOM location when supported, reproduction steps, and suggested next action.
- Distinguish directly observed defect, intentional/neutral regional difference, and hypothesis requiring investigation.
- Express uncertainty clearly; a model's self-reported confidence is not a calibrated probability.

Track AI-stage state separately from capture state. A model timeout must preserve collected evidence. A failed or unavailable region must not become a clean bill of health. Allow partial reports and retry the failed stage without duplicating a completed job unnecessarily.

## Browser collection

- Begin with at most two selected regions and a single browser profile. Use separate isolated contexts and sticky sessions for comparable observations.
- Verify the session's egress through the same browser/proxy path used to visit the target. Do not mistake a server-side direct fetch for browser egress verification.
- Capture the initial page and a small bounded set of read-only checks against explicit expectations. Prefer reliable bounded navigation over a general-purpose autonomous browser.
- Use stable screenshot settings and retain loading/error evidence. Do not report an uncompleted or blocked page as a website defect without explaining the uncertainty.
- Keep locale and timezone controlled and recorded. A locale flag or query parameter alone is not evidence of a real regional network exit.
- Recheck egress when session routing changes or the assurance could have become stale.
- Record elapsed timings with accurate labels. Browser load time is not pure network latency.
- Bound regions, pages, redirects, requests, bytes where enforceable, runtime, model calls, and concurrent jobs. Make reasonable limits configurable and documented.

## Meta AI integration

Use Meta Model API for the actual product feature. Verify current official request formats and model availability before coding:
- https://dev.meta.ai/docs/overview
- https://dev.meta.ai/models/muse-spark

The previously observed base URL was https://api.meta.ai/v1, with muse-spark-1.3 available. Keep model and base URL configurable and use the API documented at implementation time. Use server-only MODEL_API_KEY or a clearly documented equivalent. Never use a NEXT_PUBLIC variable for secrets. Choose a mode deliberately; do not silently use a contributor/training mode for users' website data.

Implement two bounded model stages where useful:
1. Convert the user goal into a validated inspection plan using a small allowed tool/check vocabulary.
2. Analyze actual screenshots, sanitized page observations, request failures, and expectations to generate a structured evidence-backed report.

Validate model output against schemas. Reject nonexistent evidence IDs, unsupported actions, and invalid locations. Mark speculative causes as hypotheses. Preserve the evidence that contradicts a finding. Treat page contents, screenshots, and model-generated text as untrusted input; a webpage must not alter tool permissions, reveal secrets, or redirect the agent to unrelated targets.

The model may request only bounded operations exposed by the worker. It must not receive arbitrary shell, unrestricted network, wallet, or credential access. Render report content safely.

Handle missing key, rate limit, refusal, malformed output, and timeout as real states with useful retry behavior. Keep retries bounded. Record provider-reported token usage where available. Calculate cost only from a documented configurable price source, clearly labeled as an estimate; do not invent usage or prices.

Use extra Meta models only if they improve the actual workflow. Complete the core inspection and report before adding image generation, segmentation, speech, or additional agents.

## Access and network boundaries

This is a website inspection service, so implement the necessary boundaries as part of the feature:
- Use existing authentication, job ownership, and rate limiting. Initially restrict live targets to explicitly configured authorized HTTPS origins and approved subresource origins.
- Validate URL parsing and redirects. Block loopback, private, link-local, metadata, and IPv4-mapped IPv6 destinations in live mode. Account for proxy-side DNS resolution; local DNS validation alone is insufficient. Reuse/enforce gateway/provider destination protections rather than assuming browser interception is a complete network boundary.
- Do not follow page instructions to unrelated hosts, submit payments, perform purchases, send messages, change remote account state, or attempt access-control bypass.
- Keep credentials out of model inputs, screenshots where controllable, reports, logs, exports, and browser-visible configuration.
- For a local fixture target, use an explicit development-only fixture harness. Do not add a general production SSRF bypass to make a demo work.
- Isolate jobs and avoid direct traffic paths that bypass the configured proxy. Document residual browser-network limitations honestly.

## Frontend experience

Add an Audits entry in the existing authenticated workspace. A reasonable route is /app/audits with an individual results page. Register new routes, navigation, policies, and middleware behavior using the actual repository conventions.

Reuse the existing typography, tokens, light/dark themes, cards, forms, status patterns, and responsive shell. Implement:
- Create audit: target URL, actual available regions, expectations, and clear evidence mode.
- Running audit: understandable stages and per-region progress, cancellation, and recoverable errors.
- Results: side-by-side region captures, observed/estimated route information, findings linked to evidence, measured timings, limitations, and retry controls.
- Rerun: retain prior report, compare the same checks, and show resolved, persisting, new, and incomparable findings without assuming screenshots align perfectly.
- Export: sanitized JSON and a useful shareable report artifact with provenance and limitations preserved. Public sharing is optional and must not bypass ownership.
- Accessible labels, keyboard focus, loading/empty/partial/error states, mobile layout, and restrained motion.

Use factual text. Avoid fake healthy statuses, fabricated region inventory, invented savings, unsupported country guarantees, and generic chat responses presented as completed audits.

## Missing infrastructure, replay, and demo fixtures

Check external prerequisites early, but do not stop the whole build because keys or provider nodes are missing. Implement the real live adapter, validation, worker, UI, and failure states. Also provide a deterministic fixture/replay mode that exercises the same contracts and pipeline.

Modes must be unmistakable:
- Live: newly collected evidence through an actual configured ProxyHubb session.
- Recorded replay: previously collected evidence with original capture timestamps, provenance, and any new analysis timestamp.
- Synthetic fixture: deliberately constructed test evidence, visibly labeled throughout.

A live Meta call analyzing synthetic evidence must still identify the evidence as synthetic. When no model is configured, display "AI analysis not run" and preserve the capture/report state. Reference expected findings used for evaluation must never masquerade as model output.

Build a small controlled demo target or fixture set with an explicitly seeded regional defect and a fixed version, plus healthy cases and legitimate regional differences. Prefer simple defects with objective ground truth, such as an expected signup control being obscured, a failed required asset, or an unexpected declared currency. Label controlled defects in documentation and the demo.

If two live regional exits cannot be obtained using existing authorized resources, finish the implementation and fixture verification, report the precise missing resources, and label live validation incomplete. Do not provision paid infrastructure, fabricate locations, or switch to an unrelated product to conceal the dependency. Do not expand into Node Doctor unless I request a pivot.

## Verification and credible evaluation

Run meaningful targeted checks for new behavior and changed contracts. Cover:
- Region mismatch, unknown country, unavailable region, sticky/failover behavior, and no silent direct/global fallback for audit jobs.
- Ownership checks, unauthorized artifact access, target validation, redirect restrictions, redaction, and bounded tool execution.
- Successful capture, partial region failure, cancellation, model failure, missing configuration, persistence across page refresh, and worker cleanup.
- Structured report validation, unknown evidence references, healthy pages, legitimate regional differences, and hypotheses versus observations.
- The primary browser workflow and a focused mobile/keyboard pass.

Create approximately 12-15 meaningful labeled evaluation cases with defects and healthy controls. Run actual AI evaluations when configured. Report counts of detected defects, missed defects, false alarms on healthy controls, supported evidence references, latency, and observed usage/cost. Keep ground truth and raw evaluation results separate. Do not claim general accuracy from a tiny seeded suite or count skipped cases as passed.

For changed frontend code, inspect and run the appropriate current scripts. Existing scripts include typecheck, validate:routes, build, and targeted Playwright tests in apps/web. Run targeted lint and relevant Go/Rust checks for changed packages. Resolve regressions caused by this feature. Record unrelated pre-existing failures separately; do not turn this sprint into repository-wide cleanup or run unchecked forced dependency upgrades.

## Delivery sequence

1. Inspect repository/configuration and record the architecture, contracts, and checklist briefly.
2. Establish genuine session/egress verification and correct health/provenance behavior.
3. Implement a single-region capture pipeline, persistent job/report state, and fixture coverage.
4. Extend to two regions and implement actual Meta plan/analysis integration with validation.
5. Complete the authenticated Audits UI, evidence views, rerun comparison, and export.
6. Run focused integration checks and evaluation, address failures, and finish setup/demo documentation.

Prefer a complete narrow workflow over disconnected unfinished components. If time becomes tight, prioritize two regions, one page, one profile, clear expectations, real evidence, actual Meta reasoning, and reliable results. Continue meaningful implementation while external prerequisites are pending.

## Required artifacts and completion criteria

Deliver working source, compatible dependency/lockfile updates, required migrations, example configuration without secrets, and reproducible startup commands.

Create docs/hackathon/REGIONAL_AUDITOR.md covering architecture, setup, environment variables, live/fixture modes, targeted checks, evaluation results, limitations, and outstanding live prerequisites. Add a concise implementation-status checklist, a demo script that follows the portal's actual requirements, and a pre-existing-versus-new-work manifest based on Git evidence. Never imply the entire existing platform was built during this hackathon.

The core feature is complete when an authorized user can create an audit, observe meaningful job states, inspect provenance-preserving regional evidence and validated AI findings, rerun it, and export a sanitized report; failures remain honest and recoverable; and relevant checks pass or have specifically documented external blockers. Live acceptance additionally requires real Meta inference and captures through two actual regional exits. Report these two completion states separately if external resources are missing.

Use the demo to show: request -> regional routing observations -> captures -> a supported finding -> fix to the controlled target -> rerun -> result comparison. Use measured results and a clear description of the user benefit. Follow the official portal's video length and submission rules rather than inventing them.

Keep progress updates concise. If context becomes limited, persist implementation status, current commands, changed files, and next steps, then continue. At the end, report implemented behavior, key files, startup instructions, checks actually run, and exact remaining blockers. Do not end with merely a plan or "I can implement this next."

Start now by inspecting Git status and repository instructions, then implement the first complete path.
