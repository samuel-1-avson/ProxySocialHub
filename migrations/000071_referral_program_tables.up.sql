CREATE TABLE IF NOT EXISTS referral_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    code VARCHAR(20) NOT NULL UNIQUE,
    uses_count INT NOT NULL DEFAULT 0,
    total_earnings NUMERIC(20,4) NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT referral_codes_user_id_key UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_referral_codes_active ON referral_codes (is_active);

CREATE TABLE IF NOT EXISTS referral_rewards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    referrer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    referred_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    referral_code VARCHAR(20) NOT NULL,
    reward_amount NUMERIC(20,4) NOT NULL,
    reward_type VARCHAR(50) NOT NULL DEFAULT 'signup' CHECK (reward_type IN ('signup', 'first_purchase', 'subscription')),
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'credited', 'expired')),
    credited_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT referral_rewards_referred_reward_type_key UNIQUE (referred_id, reward_type)
);

CREATE INDEX IF NOT EXISTS idx_referral_rewards_referrer_status ON referral_rewards (referrer_id, status);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_referred_id ON referral_rewards (referred_id);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_referral_code ON referral_rewards (referral_code);