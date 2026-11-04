# ADR 0012: Evidence-based proxy listing prices

Status: Deployed with enforcement on 2026-11-04. Initial ratings remain provisional; regional calibration remains ongoing.

## Decision

Require an assessment of the actual provider transport before a new listing is published. A versioned deterministic policy issues a price; the provider explicitly accepts it before signing and submitting the offer. Explanations come from the same structured measurements, without requiring an external model or exposing credentials to one.

This is the first release of quality pricing. All ratings are provisional. Long-term availability, independently verified network classification/location, IP reputation, rotation behavior, advertised concurrency and multi-region comparisons remain future assessment capabilities. The product must not claim they were tested.

## Flow

1. An authenticated provider submits node ID, proxy type, protocols, rotation, country and maximum concurrency to `POST /v1/proxy-assessments`.
2. The API locks the owned node row, deduplicates pending work and enforces a one-minute per-node cooldown. Client-supplied scores/prices are ignored.
3. The control API's supervised quality worker claims queued work with PostgreSQL `FOR UPDATE SKIP LOCKED`.
4. It calls the edge management endpoint `POST /internal/providers/{gatewayNodeId}/quality-check`, authenticated with the existing shared secret.
5. The owning gateway opens three fresh yamux streams to that exact provider. Each performs the normal CONNECT handshake, verifies TLS against public certificate roots and downloads exactly 262,144 bytes from `https://speed.cloudflare.com/__down?bytes=262144`. There is no buyer session, escrow or buyer billing for probe traffic. The gateway first checks that reference destination directly. The fixed destination prevents user-directed internal network fetches; responses, handshakes and deadlines are bounded. Cross-pod forwarding is limited to one hop.
6. The worker saves sample counts, transfer bytes, median and p95 response times, median throughput, policy version and explanation. It never trusts default heartbeat quality/uptime fields.
7. The editor shows the report and asks the provider to accept the generated USD/GB price. The submitted assessment ID is checked against ownership, node identity, infrastructure configuration, offer configuration, policy version, outcome, expiry and price inside the listing write transaction. The accepted price is part of the existing provider signature.

The publisher, repricing/concurrency updates and resuming a paused offer require valid evidence. Pending moderation and appeals cannot activate an unassessed listing under enforce mode. A provider can always pause or delete an offer. Automatic heartbeat activation of legacy drafts is disabled under enforce mode.

## Initial policy: proxy-quality-v1

- All three HTTPS transfers must succeed. Partial success produces no publication quote.
- Score: 45 points for complete request success, up to 35 for p95 response time, up to 20 for throughput. Latency receives full points at or below 250 ms and decreases linearly to zero at 2,750 ms. Throughput receives full points at 20 Mbps. Scores below 60 fail publication.
- Base USD/GB: residential 0.99, mobile 3.50, datacenter 0.15. These are versioned initial product baselines, not claims about current market prices.
- Multipliers: Bronze 0.8, Silver (70+) 1.0, Gold (90+) 1.2. Round the resulting price to four decimal places. There is no unverified country premium.
- Quote acceptance expires after 30 minutes. A moderation delay does not invalidate an already accepted quote; ownership, configuration and price must still match.
- `confidence = 0.3` is a conservative, heuristic evidence-maturity indicator for three samples, not a calibrated statistical probability. All assessments remain provisional. Uptime remains unmeasured rather than defaulting to 100%.
- Bulk discount overrides are unavailable for assessed offers, preventing a second seller-controlled price path.

## Monitoring and price stability

Assessed active offers are rechecked approximately every six hours. Monitoring updates evidence and may pause offers that fail the transfer test; it never rewrites provider-accepted prices, signed offers, orders, sessions or escrow. Changing node identity/configuration requires a fresh assessment and acceptance. Failed reference checks and gateway errors result in `unavailable`, not a fabricated low score. The marketplace shows the latest report and its timestamp.

Queued jobs expire after 15 minutes; running jobs expire after two minutes. Expired jobs become unavailable and can be retried. Database writes are conditional so a late worker cannot overwrite recovery decisions.

Existing active legacy listings are grandfathered until they are repriced, change concurrency or are resumed. Their old metrics do not become assessment evidence. This deliberately avoids rewriting prior offers during rollout.

## Deployment

Production deployment and live-provider evidence are recorded in [the release report](../deployments/2026-11-04-proxy-quality-pricing.md).

1. Apply migration `000177_proxy_quality_assessments` with the existing migration job. The assessment table enables RLS and is accessed through the authenticated control API; it has no direct client policies.
2. Deploy the updated edge gateway before enforcing the API flow. Existing `GATEWAY_SHARED_SECRET` and `EDGE_GATEWAY_MGMT_URL` must match the management service.
3. Deploy the control API including its background workers, then the web app. For staged rollout, explicitly set `LISTING_QUALITY_MODE=observe`; otherwise enforcement is the default. Observe mode keeps the report available while allowing legacy publication.
4. With a real connected provider, assess a new offer, accept its price, publish and check the buyer-facing report. Confirm an arbitrary price or an expired/foreign assessment is refused. Check unavailable behavior with a stopped worker/gateway and a failed assessment with a disconnected provider.
5. Review probe cost, destination availability, provider outcomes, buyer success and regional latency effects before changing policy thresholds. Each policy change requires a new version and fresh price acceptance. Broad automatic repricing, statistical uptime claims and external AI explanations are intentionally deferred until evidence supports them.

## Trade-offs and limits

Deterministic scoring is inexpensive, reproducible and auditable. A fixed public transfer endpoint introduces a third-party dependency and is recognizable to providers. The current test uses one gateway vantage point and small transfers, so it does not establish sustained capacity, universal website compatibility or long-term reliability. More diverse approved destinations and geographic baselines should follow live calibration. A gateway/control-plane outage can temporarily prevent new publication; existing purchases continue on their original terms.

The implementation includes policy/tampering tests, isolated repository write-gate tests, authenticated management-client tests, gateway handshake/TLS rejection tests and browser coverage for price acceptance, configuration changes and failures. PostgreSQL migration/locking integration tests require `TEST_DATABASE_URL`; an end-to-end live transport check requires the deployed gateway and provider.
