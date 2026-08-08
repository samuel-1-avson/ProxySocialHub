# 21 — Risk Register

Likelihood (L) and Impact (I): Low/Med/High. Residual = after planned remediation (roadmap item refs).

| ID | Risk | L | I | Linked findings | Mitigation (roadmap) | Residual |
|----|------|---|---|-----------------|----------------------|----------|
| RSK-01 | Deployed (pre-fix) program allows escrow payout redirection — active theft if bytecode on any funded cluster is the old build | Med | **Critical** | BC-01/02 | 0.3 **[done in source]** + 0.4 redeploy + bytecode verification | Low |
| RSK-02 | Session program deployed as-is → arbitrary slash/complete theft | Med | Critical | BC-03/04 | 0.5 Config PDA or keep undeployed | Low |
| RSK-03 | Oracle hot-wallet key compromise drains deposit treasury | Med | Critical | BC-08/09, SEC-03 | **Mitigated on gcp-testnet** (vault≠hot≠oracle + KMS); keep BC-09 hygiene | Low |
| RSK-04 | Forged/duplicated metering inflates buyer charges or provider earnings | Med | High | BE-01 **[fixed]**, GW-08 | 0.1/0.11 + 1.1 | Low |
| RSK-05 | Ledger/balance divergence discovered late (financial restatement, disputes) | Med | High | DB-01/02/03 | 2.1/2.2/2.8 | Med→Low |
| RSK-06 | Redis outage drops live sessions + unreported usage (revenue loss + angry buyers) | Med | High | EV-05 | 2.3 HA + PG fallback | Low |
| RSK-07 | Buyers exceed purchased limits (revenue leakage, unfair QoS) | High | Med | GW-03/05 | 1.2 | Low |
| RSK-08 | Deploy automation failure during incident (broken overlays/registry) | High | High | OPS-01/02 | 0.12-deploy fix (R-05) | Low |
| RSK-09 | k8s data-store compromise via weak pooler/Redis auth | Med | High | SEC-04/05/06 | 0.7 | Low |
| RSK-10 | DNS-rebinding via stale/malicious provider agent → LAN/IMDS exposure | Low-Med | High | GW-07, PN-04 | 1.10 lease enforcement + agent version gating | Low-Med |
| RSK-11 | Marketplace trust signals gamed (fake uptime/geo/ISP) → buyer churn, disputes | High | Med | T4, FE-06, GW-04 | 5.1 probing service; 1.4 | Med→Low |
| RSK-12 | Deposit credited then reorged out (double-spend) | Low | High | BC-07 | 2.6 finalized | Low |
| RSK-13 | Treasury/ops events silently lost (missed topups/recon alerts) | Med | Med | EV-01/02/07 | 0.10 + 2.4 | Low |
| RSK-14 | Single Postgres failure → full platform halt | Med | Med | 14 | replication + PITR (DR plan) | Med |
| RSK-15 | OTel/logs expose CONNECT targets or PII | Low | Med | SEC-11, OPS-06 | log-scrub audit + durable tracing | Low |
| RSK-16 | Admin account takeover (no evidenced lockout) | Low | High | SEC-10 | lockout policy + MFA enforcement | Low |
| RSK-17 | `Dockerfile.simple`/`:latest` deploys untested code to prod | Med | Med | FE-13, OPS-03 | pin tags; remove simple Dockerfile | Low |
| RSK-18 | Reputation/ZK claims challenged (marketed as trustless but stubbed) | Med | Med | BC-11, FE-04 | 4.5 build real or de-claim | Low |
| RSK-19 | Telemetry growth degrades OLTP (slow marketplace, failed writes) | Med (at scale) | High | EV-06 | 3.2 warehouse | Low |
| RSK-20 | Compliance: data residency/consent for residential providers unaddressed | Med | Med | 08, 13 §5 | provider consent/scheduling + legal review | Med |

## Top risks by score (L×I)

1. RSK-01 escrow redirection (until redeploy) — **highest priority**
2. RSK-03 hot-wallet treasury compromise
3. RSK-04 metering integrity (largely mitigated by this audit's fix; complete with GW-08)
4. RSK-05 ledger divergence
5. RSK-08 deploy automation failure
6. RSK-06 Redis SPOF
