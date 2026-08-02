-- Phase E: usage_receipts retention metadata (TTL via scripts/usage-receipts-ttl.sh).
-- Does not partition; cron deletes rows older than RETENTION_DAYS (default 90).

COMMENT ON TABLE public.usage_receipts IS
    'Usage metering receipts. Hot retention default 90 days via scripts/usage-receipts-ttl.sh.';

CREATE INDEX IF NOT EXISTS idx_usage_receipts_reported_at_ttl
    ON public.usage_receipts (reported_at);
