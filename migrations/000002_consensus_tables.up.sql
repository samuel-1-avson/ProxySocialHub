-- Create consensus_rounds table for quality attestation system
CREATE TABLE IF NOT EXISTS consensus_rounds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider_id UUID NOT NULL,
    node_id UUID,
    min_validators INT DEFAULT 3,
    max_deviation DECIMAL(5,2) DEFAULT 15.0,
    attestation_count INT DEFAULT 0,
    consensus_score DECIMAL(5,2) DEFAULT 0,
    consensus_reached BOOLEAN DEFAULT FALSE,
    consensus_latency INT DEFAULT 0,
    consensus_uptime INT DEFAULT 0,
    consensus_success_rate INT DEFAULT 0,
    consensus_bandwidth INT DEFAULT 0,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    finalized_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create validators table if not exists
CREATE TABLE IF NOT EXISTS validators (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE,
    hotkey VARCHAR(64) NOT NULL UNIQUE,
    coldkey VARCHAR(64),
    net_uid INT DEFAULT 1,
    staked_amount DECIMAL(20,8) DEFAULT 0,
    min_stake_required DECIMAL(20,8) DEFAULT 10,
    trust_score DECIMAL(5,2) DEFAULT 100,
    total_attestations INT DEFAULT 0,
    accurate_attestations INT DEFAULT 0,
    disputed_attestations INT DEFAULT 0,
    accuracy_rate DECIMAL(5,2) DEFAULT 100,
    total_earnings DECIMAL(20,8) DEFAULT 0,
    pending_rewards DECIMAL(20,8) DEFAULT 0,
    slashed_amount DECIMAL(20,8) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'pending',
    last_active_at TIMESTAMP WITH TIME ZONE,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create quality_attestations table with proper foreign keys
CREATE TABLE IF NOT EXISTS quality_attestations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    validator_id UUID NOT NULL,
    provider_id UUID NOT NULL,
    node_id UUID,
    latency_score INT NOT NULL,
    uptime_score INT NOT NULL,
    success_rate_score INT NOT NULL,
    bandwidth_score INT NOT NULL,
    overall_score DECIMAL(5,2) NOT NULL,
    measured_latency_ms INT,
    measured_uptime_pct DECIMAL(5,2),
    measured_success_rate DECIMAL(5,2),
    measured_bandwidth_mbps DECIMAL(10,2),
    message_hash VARCHAR(64) NOT NULL,
    signature VARCHAR(128) NOT NULL,
    is_in_consensus BOOLEAN DEFAULT FALSE,
    consensus_round_id UUID REFERENCES consensus_rounds(id),
    is_valid BOOLEAN DEFAULT TRUE,
    disputed_by UUID,
    dispute_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_quality_attestations_validator ON quality_attestations(validator_id);
CREATE INDEX IF NOT EXISTS idx_quality_attestations_provider ON quality_attestations(provider_id);
CREATE INDEX IF NOT EXISTS idx_quality_attestations_node ON quality_attestations(node_id);
CREATE INDEX IF NOT EXISTS idx_consensus_rounds_provider ON consensus_rounds(provider_id);
CREATE INDEX IF NOT EXISTS idx_consensus_rounds_node ON consensus_rounds(node_id);
