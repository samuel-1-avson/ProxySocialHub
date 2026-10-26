-- W-26 (P1): durable watcher cursors + processed-event dedup.
CREATE TABLE IF NOT EXISTS public.watcher_cursors (
    address        VARCHAR(64) PRIMARY KEY,
    last_slot      BIGINT NOT NULL DEFAULT 0,
    last_signature VARCHAR(128) NOT NULL DEFAULT '',
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.watcher_processed_events (
    tx_signature VARCHAR(128) NOT NULL,
    event_type   VARCHAR(32) NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tx_signature, event_type)
);
