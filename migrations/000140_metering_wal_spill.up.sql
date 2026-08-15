-- ============================================================
-- Migration 000140: metering WAL spill (EV-05 lite)
-- ============================================================
-- Append-only spill when edge Redis WAL/pending writes fail.
-- Drain worker promotes rows into usage_receipts.
-- Does NOT make Redis HA; sessions remain Redis SoT.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.metering_wal_spill (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_username VARCHAR(120) NOT NULL,
    bytes_up         BIGINT NOT NULL DEFAULT 0 CHECK (bytes_up >= 0),
    bytes_down       BIGINT NOT NULL DEFAULT 0 CHECK (bytes_down >= 0),
    seq              BIGINT,
    status           VARCHAR(20) NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'draining', 'drained', 'failed')),
    source           VARCHAR(64) NOT NULL DEFAULT 'redis_wal_fail',
    error            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    drained_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_metering_wal_spill_status_created
    ON public.metering_wal_spill (status, created_at);

CREATE INDEX IF NOT EXISTS idx_metering_wal_spill_session
    ON public.metering_wal_spill (session_username, created_at DESC);

COMMENT ON TABLE public.metering_wal_spill IS
    'EV-05 lite: edge metering spill when Redis WAL/pending write fails; drained into usage_receipts.';
