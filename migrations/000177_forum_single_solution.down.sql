-- Reverses 000177_forum_single_solution. Only the constraint is removed;
-- solution flags cleared by the up migration's de-duplication are not
-- restored (which historical flag was "the" solution is not recorded).
DROP INDEX IF EXISTS public.idx_forum_posts_single_solution;
