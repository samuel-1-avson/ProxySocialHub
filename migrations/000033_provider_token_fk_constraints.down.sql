-- E10: Rollback — drop FK constraints on provider_tokens and provider_node_registrations.

ALTER TABLE provider_node_registrations
    DROP CONSTRAINT IF EXISTS fk_provider_node_reg_node_id,
    DROP CONSTRAINT IF EXISTS fk_provider_node_reg_token_id,
    DROP CONSTRAINT IF EXISTS fk_provider_node_reg_user_id;

ALTER TABLE provider_tokens
    DROP CONSTRAINT IF EXISTS fk_provider_tokens_user_id;
