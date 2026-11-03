-- Reverses 000177_message_client_msg_id. Dropping the column also drops the
-- stored idempotency keys; in-flight client retries after a downgrade could
-- then duplicate a message, which is the pre-000177 behavior.
DROP INDEX IF EXISTS public.idx_messages_client_msg_id;

ALTER TABLE public.messages
    DROP COLUMN IF EXISTS client_msg_id;
