-- Reverse 000157. Dropping embedded_wallets destroys sealed keys: sweep funds first.
DROP TABLE IF EXISTS embedded_wallets;
DROP TABLE IF EXISTS user_identities;
