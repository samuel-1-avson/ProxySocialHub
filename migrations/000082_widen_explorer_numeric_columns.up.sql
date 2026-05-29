-- Alter explorer_transactions column types to unrestricted numeric to prevent overflows
ALTER TABLE explorer_transactions ALTER COLUMN amount TYPE NUMERIC;
ALTER TABLE explorer_transactions ALTER COLUMN fee TYPE NUMERIC;
