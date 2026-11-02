-- Regional Auditor jobs (services/regional-auditor).
--
-- One row per audit. The full, schema-validated job document (plan, per-region
-- evidence metadata, AI analysis, comparison) lives in `doc`; the columns kept
-- outside it exist for ownership checks, listing and recovery of abandoned jobs.
--
-- Nothing secret is stored: proxy credentials are held in worker memory for the
-- lifetime of a run and are never written here, and screenshots are private
-- artifacts on the worker's disk, referenced from `doc` by id and hash only.
--
-- owner_id is the authenticated account id as asserted by the web server over a
-- signed request. It is deliberately not a foreign key so the worker stays
-- decoupled from the users table (and can run against a database role that
-- cannot read it).
--
-- Uses only syntax available on Postgres 14 (the oldest major we deploy against).
CREATE TABLE IF NOT EXISTS public.regional_audits (
    id                VARCHAR(16)  PRIMARY KEY CHECK (id ~ '^aud_[0-9a-f]{12}$'),
    owner_id          VARCHAR(64)  NOT NULL CHECK (owner_id ~ '^[A-Za-z0-9_-]{8,64}$'),
    status            VARCHAR(16)  NOT NULL
                      CHECK (status IN ('queued', 'running', 'completed', 'partial', 'failed', 'cancelled')),
    mode              VARCHAR(16)  NOT NULL CHECK (mode IN ('live', 'fixture', 'replay')),
    previous_audit_id VARCHAR(16),
    doc               JSONB        NOT NULL,
    -- Optimistic concurrency: a writer holding an older revision is rejected.
    revision          INTEGER      NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- "My audits, newest first" and the per-owner active-job cap.
CREATE INDEX IF NOT EXISTS idx_regional_audits_owner_created
    ON public.regional_audits (owner_id, created_at DESC);
-- Recovery of jobs a previous worker process left queued or running.
CREATE INDEX IF NOT EXISTS idx_regional_audits_active
    ON public.regional_audits (status)
    WHERE status IN ('queued', 'running');
