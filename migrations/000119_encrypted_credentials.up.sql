-- P2 MIG-02: promote encrypted_credentials from shadow SQL (DDL only).

CREATE TABLE IF NOT EXISTS public.encrypted_credentials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL UNIQUE REFERENCES public.sessions(id) ON DELETE CASCADE,
    username_enc TEXT NOT NULL,
    password_enc TEXT NOT NULL,
    encrypted_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.encrypted_credentials IS
'AES-256-GCM encrypted session credentials (promoted from control-api shadow migrations).';
