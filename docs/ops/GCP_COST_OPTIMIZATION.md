# GCP cost optimization runbook (ProxyHubb + shared billing)

**Billing account:** `01F1BE-3588EA-938035` (My Billing Account 1)  
**ProxyHubb project:** `gen-lang-client-0022105784` (Gemini API)  
**ProxyHubb VM:** `proxyhubb-testnet` · `e2-standard-4` · `us-central1-a` · keep  

## Done (2026-08-06)

| Action | Result | Est. savings |
|--------|--------|--------------|
| Deleted VM `del-after` (`fiffi-500411`, e2-highcpu-4) | Removed + disks | ~$50–80/mo gross |
| Budget `Account $50 early warning` | Created | Alert at 50/90/100% |
| Budget `ProxyHubb+Gemini project $120` | Created on project `108687509435` | Project-scoped alert |
| Existing `$100 Monthly Budget Alert` | Left in place | — |

## Live inventory (same day)

| Project | What burns money | ProxyHubb? |
|---------|------------------|------------|
| `gen-lang-client-0022105784` | `proxyhubb-testnet` e2-standard-4 | **Yes — keep** |
| `gen-lang-client-0022105784` | `creg-testnet-vm` e2-medium + 100 GB (created Aug 6) | No (CREG) |
| `gen-lang-client-0022105784` | Cloud Run: `creg-hub-api`, `creg-contribution-arena-staging`, `math-quest-monster-calculator` | No |
| `arcade-7f03c` | ~13 Cloud Run services (arcade) | No |
| `gen-lang-client-0098858574` | ~33 Cloud Run services (arena*) | No — likely top Cloud Run $ |
| `fiffi-500411` | was `del-after` VM | Deleted |

No live Memorystore / Cloud SQL / GCE forwarding rules found in the ProxyHubb project (July invoice lines may be historical or other SKUs still catching up under the billing delay).

## Next (needs your confirm)

1. **Arena / Arcade Cloud Run** — largest gross line (~$60/mo CPU alone).  
   If those products are paused:  
   `CONFIRM=yes ./scripts/gcp-cost-optimize.sh scale-run-min-zero gen-lang-client-0098858574`  
   then delete idle services in Console.
2. **`creg-testnet-vm`** — stop if CREG testnet is idle (`gcloud compute instances stop creg-testnet-vm --zone=us-central1-b --project=gen-lang-client-0022105784`).
3. **Separate billing** — move ProxyHubb to its own GCP project + budget so Arcade/Arena cannot hide inside “All projects”.
4. **Re-run inventory:** `./scripts/gcp-cost-inventory.sh`

Related ops docs: [HA lite](GCP_HA_LITE.md).

- `scripts/gcp-cost-inventory.sh` — list VMs / Run / Redis / SQL on the 5 billed projects  
- `scripts/gcp-cost-optimize.sh` — helpers (inventory, list extra VMs, scale Run min=0)
