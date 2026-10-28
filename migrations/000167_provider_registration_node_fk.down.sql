-- Reverses 000167_provider_registration_node_fk (restores the nodes FK, also NOT VALID:
-- rows written since then reference provider_nodes).
ALTER TABLE provider_node_registrations DROP CONSTRAINT IF EXISTS fk_provider_node_reg_provider_node_id;
ALTER TABLE provider_node_registrations
    ADD CONSTRAINT fk_provider_node_reg_node_id
        FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE NOT VALID;
