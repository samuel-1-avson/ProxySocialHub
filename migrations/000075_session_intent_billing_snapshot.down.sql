ALTER TABLE session_intents
    DROP COLUMN IF EXISTS billing_price_source,
    DROP COLUMN IF EXISTS billing_price_per_gb_usd;