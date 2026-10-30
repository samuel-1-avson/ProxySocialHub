-- ============================================================
-- Migration 000156: provider_nodes.location_user_set
-- ============================================================
-- Set when the node owner picks the node's city on the dashboard. Gateway
-- re-registers carry an IP-derived city (often the ISP's capital, e.g. Accra
-- for a Cape Coast node); while this flag is set they must not overwrite the
-- owner's choice.
-- ============================================================

ALTER TABLE provider_nodes
    ADD COLUMN IF NOT EXISTS location_user_set BOOLEAN NOT NULL DEFAULT false;
