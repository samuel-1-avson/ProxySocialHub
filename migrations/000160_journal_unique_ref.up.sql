-- W-29 (P1): journals are unique per (external_ref, entry_type). A caller
-- retrying a money operation after an ambiguous commit must not double-post.
-- Historical duplicates are preserved but namespaced so the index can build.
WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY external_ref, entry_type ORDER BY created_at, id) AS rn
    FROM public.ledger_journals
    WHERE external_ref IS NOT NULL AND external_ref <> ''
)
UPDATE public.ledger_journals j
SET external_ref = j.external_ref || '#dup-' || j.id::text
FROM ranked r
WHERE j.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_journals_ref_type
    ON public.ledger_journals (external_ref, entry_type)
    WHERE external_ref IS NOT NULL AND external_ref <> '';
