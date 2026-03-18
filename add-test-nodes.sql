-- ============================================================================
-- Add Test Nodes to ProxyHubb Database
-- ============================================================================
-- Run this script to add sample nodes for testing the Node Map
-- 
-- How to run:
--   docker-compose exec -T postgres psql -U proxyhubb -d proxyhubb < add-test-nodes.sql
-- ============================================================================

-- First, ensure we have a provider user to associate with nodes
DO $$
BEGIN
    -- Create a test provider user if none exists
    IF NOT EXISTS (SELECT 1 FROM users WHERE email = 'test-provider@proxyhubb.com') THEN
        INSERT INTO users (id, email, username, wallet_address, created_at, updated_at)
        VALUES (
            gen_random_uuid(),
            'test-provider@proxyhubb.com',
            'TestProvider',
            '0x1234567890abcdef1234567890abcdef12345678',
            NOW(),
            NOW()
        );
    END IF;
END $$;

-- Insert test nodes with various locations
INSERT INTO nodes (
    id, 
    ip_address, 
    port, 
    connection_type, 
    is_healthy, 
    is_registered_on_chain,
    region, 
    country, 
    hotkey, 
    provider_user_id,
    quality_score,
    uptime_percent,
    created_at, 
    updated_at, 
    last_seen_at
)
SELECT 
    gen_random_uuid(),
    ip_data.ip,
    8080,
    ip_data.proxy_type,
    true,
    true,
    ip_data.region,
    ip_data.country,
    ip_data.hotkey,
    (SELECT id FROM users WHERE email = 'test-provider@proxyhubb.com' LIMIT 1),
    85 + (random() * 15),  -- Quality score between 85-100
    95 + (random() * 5),   -- Uptime between 95-100%
    NOW(),
    NOW(),
    NOW()
FROM (VALUES
    ('192.168.1.100', 'http', 'af-west-1', 'Ghana', 'ghana-accra-1'),
    ('192.168.1.101', 'socks5', 'af-west-1', 'Ghana', 'ghana-kumasi-1'),
    ('192.168.1.102', 'http', 'us-east-1', 'United States', 'us-virginia-1'),
    ('192.168.1.103', 'socks5', 'us-west-1', 'United States', 'us-california-1'),
    ('192.168.1.104', 'http', 'eu-west-1', 'Germany', 'germany-frankfurt-1'),
    ('192.168.1.105', 'http', 'eu-west-2', 'United Kingdom', 'uk-london-1'),
    ('192.168.1.106', 'socks5', 'ap-southeast-1', 'Singapore', 'singapore-1'),
    ('192.168.1.107', 'http', 'ap-northeast-1', 'Japan', 'japan-tokyo-1'),
    ('192.168.1.108', 'http', 'sa-east-1', 'Brazil', 'brazil-sao-paulo-1'),
    ('192.168.1.109', 'socks5', 'ap-south-1', 'India', 'india-mumbai-1'),
    ('192.168.1.110', 'http', 'af-south-1', 'South Africa', 'sa-johannesburg-1'),
    ('192.168.1.111', 'http', 'eu-central-1', 'France', 'france-paris-1')
) AS ip_data(ip, proxy_type, region, country, hotkey)
WHERE NOT EXISTS (SELECT 1 FROM nodes WHERE hotkey = ip_data.hotkey);

-- Verify insertion
SELECT 'Main nodes table:' AS table_name, COUNT(*) AS node_count FROM nodes
UNION ALL
SELECT 'Healthy nodes:' AS table_name, COUNT(*) AS node_count FROM nodes WHERE is_healthy = true;
