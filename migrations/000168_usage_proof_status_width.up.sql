-- usage_proofs.status is VARCHAR(20), but UsageProofSettlingConfidential is
-- "settling_confidential" (21 chars): every escrow-session termination failed to write
-- its usage proof (value too long for type character varying(20)). No view depends on it.
ALTER TABLE usage_proofs ALTER COLUMN status TYPE VARCHAR(32);
