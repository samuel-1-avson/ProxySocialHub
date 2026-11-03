-- Persisted people-suggestion dismissals (audit F10) so a dismissed
-- suggestion does not resurface on the next load or another device.
CREATE TABLE IF NOT EXISTS public.suggestion_dismissals (
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    dismissed_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, dismissed_user_id)
);
