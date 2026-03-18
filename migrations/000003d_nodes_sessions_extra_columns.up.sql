-- Columns added to nodes and sessions via GORM AutoMigrate in Supabase.
-- Never captured in a numbered migration. Must exist before migration 000035
-- which builds a materialized view joining nodes and sessions.
-- All statements are idempotent (ADD COLUMN IF NOT EXISTS).

-- ===========================================================================
-- NODES: extra columns the Node GORM model expects
-- ===========================================================================
ALTER TABLE public.nodes
    ADD COLUMN IF NOT EXISTS provider_user_id   UUID,
    ADD COLUMN IF NOT EXISTS port               INT          NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS protocol           VARCHAR(10)  NOT NULL DEFAULT 'http',
    ADD COLUMN IF NOT EXISTS country_code       VARCHAR(10),
    ADD COLUMN IF NOT EXISTS region             VARCHAR(100),
    ADD COLUMN IF NOT EXISTS city               VARCHAR(100),
    ADD COLUMN IF NOT EXISTS isp                VARCHAR(100),
    ADD COLUMN IF NOT EXISTS connection_type    VARCHAR(50),
    ADD COLUMN IF NOT EXISTS is_healthy         BOOLEAN      NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS active_connections INT          NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS max_connections    INT          NOT NULL DEFAULT 100,
    ADD COLUMN IF NOT EXISTS latency_ms         INT          NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_bytes_up     BIGINT       NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_bytes_down   BIGINT       NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS uptime_percent     NUMERIC(5,2) NOT NULL DEFAULT 100,
    ADD COLUMN IF NOT EXISTS success_rate       NUMERIC(5,4) NOT NULL DEFAULT 1.0,
    ADD COLUMN IF NOT EXISTS quality_score      NUMERIC(5,2) NOT NULL DEFAULT 100,
    ADD COLUMN IF NOT EXISTS last_seen_at       TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS gateway_node_id    VARCHAR(128),
    ADD COLUMN IF NOT EXISTS is_registered_on_chain BOOLEAN  NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS net_uid            INT          NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS hotkey             VARCHAR(64),
    ADD COLUMN IF NOT EXISTS staked_amount_sol  NUMERIC(20,9) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_nodes_provider_user_id  ON public.nodes (provider_user_id);
CREATE INDEX IF NOT EXISTS idx_nodes_gateway_node_id   ON public.nodes (gateway_node_id);

-- ===========================================================================
-- SESSIONS: extra columns the Session GORM model expects
-- ===========================================================================
ALTER TABLE public.sessions
    ADD COLUMN IF NOT EXISTS listing_id     UUID REFERENCES public.proxy_listings(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS tx_hash        VARCHAR(255),
    ADD COLUMN IF NOT EXISTS bandwidth_limit BIGINT       NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS start_time     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS end_time       TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS bytes_used     BIGINT       NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS strategy       VARCHAR(50),
    ADD COLUMN IF NOT EXISTS max_price      NUMERIC(20,8) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_sessions_listing_id ON public.sessions (listing_id);
