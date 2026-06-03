-- Beta program task completions (in-app tracker for community-testing program)
CREATE TABLE IF NOT EXISTS beta_program_completions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    task_slug VARCHAR(64) NOT NULL,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source VARCHAR(32) NOT NULL DEFAULT 'manual',
    UNIQUE (user_id, task_slug)
);

CREATE INDEX IF NOT EXISTS idx_beta_program_completions_user ON beta_program_completions(user_id);
