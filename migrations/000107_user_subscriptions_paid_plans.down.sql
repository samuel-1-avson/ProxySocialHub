DROP INDEX IF EXISTS idx_user_subscriptions_period_end;
DROP INDEX IF EXISTS idx_user_subscriptions_user_status;
DELETE FROM subscription_plans WHERE LOWER(name) IN ('pro', 'scale');
DROP TABLE IF EXISTS user_subscriptions;
