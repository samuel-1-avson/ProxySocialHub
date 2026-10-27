-- provider_node_registrations.node_id holds provider_nodes.id since P2
-- (api/provider_token.go: getOrCreateNodeID / createProviderNodeForToken), but both
-- foreign keys on it (000003c inline, 000033 fk_provider_node_reg_node_id) still point
-- at the legacy nodes table. Every new registration insert failed the FK, the callers
-- ignore that error, and no registration was ever stored (gcp-testnet: 0 rows).
--
-- Point the column at provider_nodes. NOT VALID so rows that still hold a legacy
-- nodes.id (resolveRegistrationNodeID handles both) are not re-checked; new and
-- updated rows are.
ALTER TABLE provider_node_registrations DROP CONSTRAINT IF EXISTS provider_node_registrations_node_id_fkey;
ALTER TABLE provider_node_registrations DROP CONSTRAINT IF EXISTS fk_provider_node_reg_node_id;
ALTER TABLE provider_node_registrations
    ADD CONSTRAINT fk_provider_node_reg_provider_node_id
        FOREIGN KEY (node_id) REFERENCES provider_nodes(id) ON DELETE CASCADE NOT VALID;
