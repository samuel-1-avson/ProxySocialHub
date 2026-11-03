-- Client-generated idempotency key for message sends (audit F05). The web
-- client generates one key per draft send attempt and reuses it when an
-- ambiguous failure is retried, so a retry can never create a duplicate.
ALTER TABLE public.messages
    ADD COLUMN IF NOT EXISTS client_msg_id VARCHAR(128);

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_client_msg_id
    ON public.messages (conversation_id, sender_id, client_msg_id)
    WHERE client_msg_id IS NOT NULL;
