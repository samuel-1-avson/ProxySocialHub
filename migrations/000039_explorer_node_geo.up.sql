-- Add precise geolocation fields to explorer_nodes
ALTER TABLE explorer_nodes
    ADD COLUMN IF NOT EXISTS city      VARCHAR(100) DEFAULT '',
    ADD COLUMN IF NOT EXISTS isp       VARCHAR(200) DEFAULT '',
    ADD COLUMN IF NOT EXISTS latitude  NUMERIC(10,6) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS longitude NUMERIC(10,6) DEFAULT 0;
