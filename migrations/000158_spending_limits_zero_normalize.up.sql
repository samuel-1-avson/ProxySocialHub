-- P0-5 (W-06): CheckSpendingLimit now treats a stored limit of 0 as
-- "zero spending allowed" (its documented P2-17 semantics) instead of
-- silently unlimited. Normalise wallets that accumulated zero limits under
-- the old inverted code to their trust-tier defaults so the code change
-- does not suddenly freeze them; tier defaults are also the spend-time
-- ceilings enforced from now on.

UPDATE public.wallets w
SET daily_limit = CASE WHEN w.daily_limit <= 0 THEN CASE p.trust_tier WHEN 'premium' THEN 100 WHEN 'verified' THEN 50 ELSE 10 END ELSE w.daily_limit END,
    weekly_limit = CASE WHEN w.weekly_limit <= 0 THEN CASE p.trust_tier WHEN 'premium' THEN 500 WHEN 'verified' THEN 200 ELSE 50 END ELSE w.weekly_limit END,
    monthly_limit = CASE WHEN w.monthly_limit <= 0 THEN CASE p.trust_tier WHEN 'premium' THEN 2000 WHEN 'verified' THEN 500 ELSE 100 END ELSE w.monthly_limit END
FROM public.profiles p
WHERE p.id = w.user_id
  AND w.limits_enabled = true
  AND (w.daily_limit <= 0 OR w.weekly_limit <= 0 OR w.monthly_limit <= 0);

-- Wallets without a matching profile (orphans): apply the most
-- conservative (new-user) defaults.
UPDATE public.wallets w
SET daily_limit = CASE WHEN w.daily_limit <= 0 THEN 10 ELSE w.daily_limit END,
    weekly_limit = CASE WHEN w.weekly_limit <= 0 THEN 50 ELSE w.weekly_limit END,
    monthly_limit = CASE WHEN w.monthly_limit <= 0 THEN 100 ELSE w.monthly_limit END
WHERE w.limits_enabled = true
  AND (w.daily_limit <= 0 OR w.weekly_limit <= 0 OR w.monthly_limit <= 0);

COMMENT ON COLUMN public.wallets.daily_limit IS 'Maximum SOL per day when limits_enabled (0 = zero allowed, P0-5)';
COMMENT ON COLUMN public.wallets.weekly_limit IS 'Maximum SOL per week when limits_enabled (0 = zero allowed, P0-5)';
COMMENT ON COLUMN public.wallets.monthly_limit IS 'Maximum SOL per month when limits_enabled (0 = zero allowed, P0-5)';
