-- E10: Add FK constraints on provider_tokens and provider_node_registrations.
-- GORM tags declare the relationships but GORM AutoMigrate does not create
-- FK constraints by default — adding them here ensures referential integrity
-- is enforced at the database layer.

-- provider_tokens.user_id → users.id
ALTER TABLE provider_tokens
    ADD CONSTRAINT fk_provider_tokens_user_id
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- provider_node_registrations.user_id → users.id
ALTER TABLE provider_node_registrations
    ADD CONSTRAINT fk_provider_node_reg_user_id
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- provider_node_registrations.token_id → provider_tokens.id
ALTER TABLE provider_node_registrations
    ADD CONSTRAINT fk_provider_node_reg_token_id
        FOREIGN KEY (token_id) REFERENCES provider_tokens(id) ON DELETE CASCADE;

-- provider_node_registrations.node_id → nodes.id
ALTER TABLE provider_node_registrations
    ADD CONSTRAINT fk_provider_node_reg_node_id
        FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE;
