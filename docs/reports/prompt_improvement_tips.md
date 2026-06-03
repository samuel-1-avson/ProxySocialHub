# Prompt Improvement Tips — ProxyHubb (from session analysis)

Derived from first-shot and low-severity sessions (`59e9a608`, `68ce593b`, `e1c2bfa6`) and from failure patterns in high-replan sessions. Use as copy-paste starters.

---

## Template A — Bounded delivery (best for Antigravity/Cursor implementation)

```text
Goal: [one sentence]

In scope:
- [file or subsystem 1]
- [file or subsystem 2]

Out of scope:
- [explicit non-goals]

Done when:
- [ ] [test command or HTTP check]
- [ ] [docker service healthy]
- [ ] [UI behavior]

Do not edit: [plan file / spec path if any]
```

---

## Template B — Docker-backed feature

```text
Everything must run via existing docker-compose.dev.yml (no host-only services).

Done when:
1. `docker compose -f docker-compose.dev.yml ps` shows [service] healthy
2. `[script].ps1` exits 0 and prints [expected line]
3. [API endpoint] returns [status/body shape]

If bootstrap fails, stop and report logs from [container] — do not patch unrelated files.
```

*Addresses verification churn seen in provider bootstrap / proof sessions.*

---

## Template C — Analysis / deep dive (no ratings unless asked)

```text
Produce a markdown report at docs/reports/[NAME].md with:
1. Architecture (components + data flow)
2. Strengths (with file references)
3. Weaknesses / risks (with file references)
4. Prioritized recommendations (P0–P2)

Do not include numeric scores or letter grades unless I ask.
Max length: [N] pages equivalent.
```

---

## Template D — Phase gate (split mega-threads)

Use **separate conversations**:

1. **Research only** — Template C; no code changes.  
2. **Implement** — attach plan; Template A; frozen spec.  
3. **Verify on Docker** — Template B only.  
4. **Git** — explicit branch name; list commits to push; no force-push.

---

## High-sufficiency habits (observed)

| Habit | Example |
|:---|:---|
| Name exact files | `services/control-api/internal/api/gdpr.go` |
| Require walkthrough | “Update walkthrough.md with test commands run” |
| One primary deliverable | “Only the report” vs “only the hook” |
| Verification in prompt | `go test ./internal/api/...`, `verify-provider-proofs-docker.ps1` |

---

## Low-sufficiency patterns to avoid

- “Analyze the entire system” without subsystem list or output path  
- “Rate it” / “score out of 10” when you want actionable engineering output  
- Stacking security + feature + git push in one message after work already started  
- “Continue” without stating which phase or acceptance criteria failed  

---

*Source: [`session_analysis_report.md`](./session_analysis_report.md) (2026-06-03).*
