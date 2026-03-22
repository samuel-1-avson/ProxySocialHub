-- Remove kyc_status column from profiles table
ALTER TABLE profiles DROP COLUMN IF EXISTS kyc_status;
