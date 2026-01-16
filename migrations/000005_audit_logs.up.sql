-- Migration: Create Audit Logs table
-- Version: 000005
-- Description: Audit logging for admin actions and security events

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_email VARCHAR(255),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,           -- 'user', 'session', 'kyc', 'wallet', 'node', 'api_key'
    entity_id VARCHAR(100),
    details JSONB,
    ip_address VARCHAR(45),
    user_agent VARCHAR(500),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_type ON audit_logs(entity_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_id ON audit_logs(entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- Comments
COMMENT ON TABLE audit_logs IS 'Audit trail for all admin and security-critical actions';
COMMENT ON COLUMN audit_logs.action IS 'Action type: user.ban, user.unban, kyc.approve, kyc.reject, session.terminate, etc.';
COMMENT ON COLUMN audit_logs.entity_type IS 'Type of entity affected by the action';
COMMENT ON COLUMN audit_logs.details IS 'JSON object with additional context about the action';
