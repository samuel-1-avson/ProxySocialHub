-- Stub Supabase auth schema for local Docker development.
-- In production this schema is managed by Supabase GoTrue.
-- This file runs once on first postgres container init (docker-entrypoint-initdb.d).

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email               VARCHAR(255) UNIQUE,
    raw_user_meta_data  JSONB DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Stub auth.uid() — returns NULL in local dev (RLS policies are not enforced by the API)
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$
  SELECT NULL::UUID;
$$ LANGUAGE SQL STABLE;

-- Stub auth.role() — used by some RLS policies
CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT AS $$
  SELECT 'anon'::TEXT;
$$ LANGUAGE SQL STABLE;

-- Stub auth.email() — used by some RLS policies
CREATE OR REPLACE FUNCTION auth.email() RETURNS TEXT AS $$
  SELECT NULL::TEXT;
$$ LANGUAGE SQL STABLE;

-- Supabase roles used in RLS policies — stub them for local Docker dev.
-- Roles are cluster-wide, and the Go test harness builds several databases at
-- once, so a concurrent session may create the same role first: an existence
-- check would race, so attempt the CREATE and treat "already there" as done.
DO $$
DECLARE
    r TEXT;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        BEGIN
            EXECUTE format('CREATE ROLE %I NOLOGIN', r);
        EXCEPTION WHEN duplicate_object OR unique_violation THEN
            NULL;
        END;
    END LOOP;
END $$;
