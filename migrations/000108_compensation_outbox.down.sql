DROP TRIGGER IF EXISTS trg_compensation_outbox_updated_at ON compensation_outbox;
DROP FUNCTION IF EXISTS update_compensation_outbox_updated_at();
DROP TABLE IF EXISTS compensation_outbox;
