-- Revert explorer_transactions column types to numeric(20,8)
ALTER TABLE explorer_transactions ALTER COLUMN amount TYPE NUMERIC(20,8);
ALTER TABLE explorer_transactions ALTER COLUMN fee TYPE NUMERIC(20,8);
