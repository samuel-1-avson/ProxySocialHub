-- At most one accepted solution per forum thread (audit F11). Existing
-- data may already violate this because solution updates were two separate
-- writes; keep the most recently updated solution per thread and clear the
-- rest (posts themselves are untouched), then enforce with a partial
-- unique index.
WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY thread_id
               ORDER BY updated_at DESC, created_at DESC, id DESC
           ) AS rn
    FROM public.forum_posts
    WHERE is_solution = true
)
UPDATE public.forum_posts p
SET is_solution = false
FROM ranked r
WHERE p.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_forum_posts_single_solution
    ON public.forum_posts (thread_id)
    WHERE is_solution;
