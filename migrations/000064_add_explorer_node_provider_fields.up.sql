ALTER TABLE explorer_nodes ADD COLUMN IF NOT EXISTS provider_user_id UUID;
ALTER TABLE explorer_nodes ADD COLUMN IF NOT EXISTS provider_username VARCHAR(255);
