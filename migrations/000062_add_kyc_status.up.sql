-- Add kyc_status column to profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS kyc_status VARCHAR(50) DEFAULT 'none';

-- Update existing users to have 'none' if they don't
UPDATE profiles SET kyc_status = 'none' WHERE kyc_status IS NULL;
