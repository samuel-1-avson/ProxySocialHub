-- SYSTEM CONFIGURATIONS (needed by seeding in db/seeds.go)
-- Created via GORM AutoMigrate in Supabase, never captured in a numbered migration.
CREATE TABLE IF NOT EXISTS system_configurations (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key         VARCHAR(100) UNIQUE NOT NULL,
    value       TEXT NOT NULL DEFAULT '',
    description TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
