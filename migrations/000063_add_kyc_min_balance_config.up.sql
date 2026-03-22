INSERT INTO system_configurations (key, value, description, updated_at)
VALUES ('kyc.min_sol_balance', '0.05', 'Minimum SOL balance required in wallet for KYC verification upgrade', NOW())
ON CONFLICT (key) DO NOTHING;
