-- Traffic-first listing price backfill: lower seller rates above our suggested
-- undercut vs centralized mid-market (IPRoyal ~$1.75+, Bright PAYG ~$4–8).
-- Does not raise listings already at or below the suggested rate.

UPDATE proxy_listings
SET price_per_gb = 0.99,
    updated_at = NOW()
WHERE proxy_type = 'residential'
  AND status <> 'deleted'
  AND price_per_gb > 0.99;

UPDATE proxy_listings
SET price_per_gb = 3.50,
    updated_at = NOW()
WHERE proxy_type = 'mobile'
  AND status <> 'deleted'
  AND price_per_gb > 3.50;

UPDATE proxy_listings
SET price_per_gb = 0.15,
    updated_at = NOW()
WHERE proxy_type = 'datacenter'
  AND status <> 'deleted'
  AND price_per_gb > 0.15;

-- Session/matching node base prices (quality tiers).
UPDATE nodes
SET base_price_per_gb = CASE
      WHEN quality_score >= 90 THEN 1.25
      WHEN quality_score >= 70 THEN 0.99
      ELSE 0.80
    END,
    updated_at = NOW()
WHERE base_price_per_gb > 1.25;

UPDATE provider_nodes
SET base_price_per_gb = CASE
      WHEN quality_score >= 90 THEN 1.25
      WHEN quality_score >= 70 THEN 0.99
      ELSE 0.80
    END,
    updated_at = NOW()
WHERE base_price_per_gb > 1.25;
