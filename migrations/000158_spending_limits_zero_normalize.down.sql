-- Data normalization only; zero-limit values that were replaced with tier
-- defaults cannot be distinguished from user-chosen defaults, so the down
-- migration intentionally leaves limit values untouched.
SELECT 1;
