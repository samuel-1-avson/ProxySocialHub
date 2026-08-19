# Evidence: join hosts stopped (not deleted) — 2026-08-19

## Verdict

**PASS** — `W7D_JOIN_HOSTS_STOPPED`. Disks kept. Seeds stay on those disks.
`operator_org_diversity` remains **`multi_org`** (Postgres cache + pin),
confirmed on `GET https://api.proxyhubb.com/v1/system/config/public` after
stop.

Do **not** delete these VMs unless the keys are backed up off-box (not to
Host-A).

## Status

| VM | Project | Zone | After |
|----|---------|------|--------|
| `proxyhubb-w7d-ext` | `fiffi-500411` | us-central1-a | `TERMINATED` |
| `proxyhubb-w11b-org3` | `gen-lang-client-0098858574` | us-central1-a | `TERMINATED` |

Operator-minted CONNECT was signed on `proxyhubb-w7d-ext` **before** stop
([`W11_A_enforce_soak_20260819.md`](W11_A_enforce_soak_20260819.md)). Org-3
was not needed for that mint.

## Replay

```
gcloud compute instances stop proxyhubb-w7d-ext \
  --project=fiffi-500411 --zone=us-central1-a
gcloud compute instances stop proxyhubb-w11b-org3 \
  --project=gen-lang-client-0098858574 --zone=us-central1-a
```

## Non-claims

- Stopping is not deleting
- Not a drop of `multi_org`
- Not DePIN
