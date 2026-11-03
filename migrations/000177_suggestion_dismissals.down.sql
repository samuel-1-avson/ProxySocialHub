-- Reverses 000177_suggestion_dismissals. Drops recorded dismissals;
-- previously dismissed people may be suggested again.
DROP TABLE IF EXISTS public.suggestion_dismissals;
