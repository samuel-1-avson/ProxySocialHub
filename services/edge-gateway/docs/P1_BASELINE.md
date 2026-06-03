# P1 performance baseline

Signed-off numbers live in [`P1_SIGNOFF.md`](P1_SIGNOFF.md) (10k snapshot read ~38 ns vs rebuild ~1.26 ms).

Raw criterion bench logs were removed 2026-06-03 to reduce repo noise. Re-generate with:

```powershell
cd services/edge-gateway
.\scripts\p1-record-baseline.ps1
```

That script appends a new run section here if you need fresh machine-specific timings.
