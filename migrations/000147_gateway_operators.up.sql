-- ============================================================
-- Migration 000147: gateway operators (Wave 5.B / ADR-0007)
-- ============================================================
-- Centralized discovery registry for logical gateway operators.
-- Same-host J2 multipod can seed two rows (edge-a / edge-b).
-- Not on-chain stake; bonded is an observe-mode hook field.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.gateway_operators (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug                VARCHAR(64) NOT NULL UNIQUE,
    display_name        VARCHAR(128) NOT NULL,
    pubkey              VARCHAR(64) NOT NULL DEFAULT '',
    buyer_base_url      TEXT NOT NULL,
    health_url          TEXT NOT NULL DEFAULT '',
    tunnel_addrs        TEXT[] NOT NULL DEFAULT '{}',
    peer_urls           TEXT[] NOT NULL DEFAULT '{}',
    stake_account       VARCHAR(64) NOT NULL DEFAULT '',
    min_stake_lamports  BIGINT NOT NULL DEFAULT 0,
    bonded              BOOLEAN NOT NULL DEFAULT TRUE,
    status              VARCHAR(20) NOT NULL DEFAULT 'active',
    last_healthy_at     TIMESTAMPTZ,
    last_edge_pod_id    VARCHAR(64) NOT NULL DEFAULT '',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT gateway_operators_status_chk
        CHECK (status IN ('active', 'disabled'))
);

CREATE INDEX IF NOT EXISTS idx_gateway_operators_status
    ON public.gateway_operators (status);

COMMENT ON TABLE public.gateway_operators IS
    'Wave 5.B: centralized gateway operator discovery (ADR-0007); not DePIN.';
