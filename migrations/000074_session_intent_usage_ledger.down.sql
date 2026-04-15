ALTER TABLE session_intents
    DROP COLUMN IF EXISTS last_metered_at,
    DROP COLUMN IF EXISTS usage_update_count,
    DROP COLUMN IF EXISTS last_bytes_down_delta,
    DROP COLUMN IF EXISTS last_bytes_up_delta,
    DROP COLUMN IF EXISTS total_bytes_down,
    DROP COLUMN IF EXISTS total_bytes_up;