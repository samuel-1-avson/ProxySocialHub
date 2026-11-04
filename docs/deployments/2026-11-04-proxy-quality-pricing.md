# Proxy quality pricing deployment — 2026-11-04

Quality-based publication pricing is deployed on `proxyhubb.com`. The live proof policy returns `mode: enforce`, `required: true`, and `quality_assessment_required: true`. Initial assessments remain provisional.

## Release

The production build preserves the privacy/custody changes from `58179a531f7a76db8609cfa3ba294552e8a34e24` and the provider rules merged in `8232dc37038586f075b330593076ed284499a5c3`. Runtime source is committed as `590beac02df9c1b1a8793191b5a1c90e2d816ab5` on `codex/proxy-quality-pricing` in the isolated release worktree.

Images are pinned by digest in `/etc/proxyhubb/releases/quality-20261103.compose.json` on the main host and the corresponding `.west.compose.json` on the west host:

| Component | Artifact Registry digest |
| --- | --- |
| Gateway, all three instances | `sha256:aac3cbb6840cc7cddd3dc4853d5c26871a1399d6974a03a1fc71d058ea27ff49` |
| Control API | `sha256:fabfea07a8f9f0e7bea77c6ba5f5bf4224121c3a4a399d1cfbeffe16df9b4f0c` |
| Web | `sha256:76c570c7ddc605104e4fc58e52f603c66ba198cd431bb2890f2c3ca147b35088` |

Registry prefix: `us-central1-docker.pkg.dev/gen-lang-client-0022105784/proxyhubb-releases/`.

Migration `000177_proxy_quality_assessments` was applied transactionally to the live database. The assessment table's RLS, its indexes, and the listing assessment column were verified. The pre-migration custom-format backup is 617,933,518 bytes and its restore index was validated.

The API first ran in observation mode. Enforcement was enabled after the updated main gateways and web became healthy. All three gateway containers, API, web, and Redis were subsequently healthy with zero restarts for the new containers. Independent Explorer and unrelated services were preserved.

## Live verification

The tests used temporary provider identities and the distributed provider daemon version 1.0.12, with verified TLS and real yamux connections. There were no mocked measurement responses or fabricated scores.

| Scenario | Observed result |
| --- | --- |
| Connected Ghana provider | 3/3 HTTPS transfers; 786,432 bytes; p95 2,017.70 ms; median throughput 4.08 Mbps; score 59.33. Publication correctly failed below 60; no price was issued. |
| Controlled datacenter provider | 3/3 transfers; 786,432 bytes; p95 272.78 ms; median throughput 73.48 Mbps; score 99.68. Provisional Gold quote: $0.18/GB. |
| Browser publication | The production editor assessed the datacenter node, displayed the report, accepted the generated price, signed the offer, and published it with HTTP 201 and `listing_offer_verified: true`. |
| Public listing read | An unauthenticated request returned HTTP 200 with the provisional report, 30% evidence confidence, timestamp, and assessed price. Privacy redaction remained active. |
| Correctly signed wrong price | HTTP 400: accept the assessed price before publishing. |
| Unknown assessment ID | HTTP 400: quality assessment not found. |
| Missing assessment ID | HTTP 400: quality assessment required. |
| Disconnected provider | 0/3 transfers, zero bytes, score zero; no publication price issued. |
| West-to-primary forwarding | Authenticated west management request reached the actual provider through its owning primary gateway and completed 3/3 transfers. |
| Public management route | The buyer TLS listener rejected the management request with HTTP 403. |

Assessment IDs: Ghana connected `b2c86942-2a69-4a73-a30b-332702769350`; datacenter `e6dc45cf-4d5d-4ae8-8f16-f4d1211a4521`; disconnected `4c520313-8424-41a6-a8b9-1b89f3be375b`.

Temporary listing `8fcc96b4-a917-4fb5-9551-6a67786c7b65` was paused and deleted after verification. Both temporary provider keys were revoked, the browser session was expired and verified to return HTTP 401, both provider processes were stopped, and both test nodes were archived. No active test offers remain. No buyer orders or purchases were created. The existing devnet registration/commitment workers ran normally for the temporary provider and signed offer.

## Compatibility and fleet repairs

The live daemon exposed a legacy heartbeat identity mismatch. The API now accepts either the canonical gateway identity or the authenticated owner's legacy runtime identity when reconstructing a signed heartbeat. Node ownership, the signed provider-node UUID, registered key binding, payload verification, and signature verification remain required. Both real provider heartbeats verified after deployment.

The west gateway had been repeatedly failing its private Redis connection before this release. The intended private VPC API/Redis bindings were restored, peer URLs now point to the private management listeners, and the west gateway received the current trusted TLS certificate. Management remains on private addresses. The west certificate expires on 2026-12-28 and must be rotated with the fleet; the existing automatic primary certificate sync does not independently update the west host.

## Validation and rollback

- 31 targeted Go tests passed against PostgreSQL, with no skips, including queue ownership/deduplication, mandatory assessment publication, repository tampering gates, worker transport behavior, and heartbeat identity scope.
- Local implementation validation also passed four gateway quality tests, 13 seller browser tests, web typechecking, and the broader backend suite available without PostgreSQL.
- Production web compilation and TypeScript checking passed. A final fleet check confirmed the expected immutable image references and enforcement policy.

Host-side evidence, rollback container specifications, rollback image tags, and the database backup are retained under `/opt/proxyhubb-releases/quality-20261103/`. Credential-bearing snapshots are root-only under `rollback/` and `private/`; they must never be committed or copied into public reports. Safe evidence files include `migration-evidence.json`, `backend-tests-evidence.json`, `fleet-verification.json`, and `cleanup-evidence.json`.

For rollback, restore the saved per-service image/environment/port specifications and roll only the affected services. Keep the additive assessment migration and evidence unless a separately reviewed schema rollback is necessary. Do not restore the full database over subsequent user activity or recreate unrelated services.

## Limits

This establishes the production assessment, price acceptance, signature, and publication path. Three small transfers from one owning gateway do not certify sustained capacity, uptime, IP reputation, connection type, location, rotation, or advertised concurrency. The heuristic confidence remains 0.3. The Ghana result demonstrates why regional latency effects need calibration before interpreting the initial thresholds as universal market quality. See [ADR 0012](../adr/0012-proxy-quality-pricing.md) for policy and monitoring behavior.
