ALTER TABLE usage_receipts
    DROP CONSTRAINT IF EXISTS fk_usage_receipts_manifest;

DROP TABLE IF EXISTS settlement_manifests;