-- Compatibility migration for still-registered circle-pool and agent-marketplace features.
-- These tables are used by live routes but were never created by the active root migration set.

CREATE TABLE IF NOT EXISTS public.agents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    public_key TEXT NOT NULL UNIQUE,
    capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
    reputation_score DOUBLE PRECISION NOT NULL DEFAULT 0,
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agents_owner_id ON public.agents(owner_id);
CREATE INDEX IF NOT EXISTS idx_agents_deleted_at ON public.agents(deleted_at);

CREATE TABLE IF NOT EXISTS public.agent_outputs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
    content_hash VARCHAR(64) NOT NULL,
    signature TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_outputs_agent_id ON public.agent_outputs(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_outputs_content_hash ON public.agent_outputs(content_hash);
CREATE INDEX IF NOT EXISTS idx_agent_outputs_deleted_at ON public.agent_outputs(deleted_at);

CREATE TABLE IF NOT EXISTS public.market_agents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    version VARCHAR(50) NOT NULL,
    price_per_run DOUBLE PRECISION NOT NULL DEFAULT 0,
    docker_image TEXT NOT NULL,
    categories JSONB NOT NULL DEFAULT '[]'::jsonb,
    parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_market_agents_deleted_at ON public.market_agents(deleted_at);

CREATE TABLE IF NOT EXISTS public.agent_instances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    market_agent_id UUID NOT NULL REFERENCES public.market_agents(id) ON DELETE CASCADE,
    name TEXT,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    schedule TEXT,
    last_run_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_instances_user_id ON public.agent_instances(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_instances_market_agent_id ON public.agent_instances(market_agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_instances_deleted_at ON public.agent_instances(deleted_at);

CREATE TABLE IF NOT EXISTS public.agent_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_instance_id UUID NOT NULL REFERENCES public.agent_instances(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    result JSONB NOT NULL DEFAULT '{}'::jsonb,
    logs TEXT NOT NULL DEFAULT '',
    duration_sec DOUBLE PRECISION NOT NULL DEFAULT 0,
    cost DOUBLE PRECISION NOT NULL DEFAULT 0,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_jobs_agent_instance_id ON public.agent_jobs(agent_instance_id);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_status ON public.agent_jobs(status);

CREATE TABLE IF NOT EXISTS public.circle_quotes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    circle_id UUID NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
    requester_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    bandwidth_gb DOUBLE PRECISION NOT NULL,
    duration_months INTEGER NOT NULL,
    base_price DOUBLE PRECISION NOT NULL,
    discount_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
    final_price DOUBLE PRECISION NOT NULL,
    requirements TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_circle_quotes_circle_id ON public.circle_quotes(circle_id);
CREATE INDEX IF NOT EXISTS idx_circle_quotes_requester_id ON public.circle_quotes(requester_id);

CREATE TABLE IF NOT EXISTS public.circle_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    circle_id UUID NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
    buyer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    provider_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    quote_id UUID REFERENCES public.circle_quotes(id) ON DELETE SET NULL,
    total_gb DOUBLE PRECISION NOT NULL,
    used_gb DOUBLE PRECISION NOT NULL DEFAULT 0,
    duration_months INTEGER NOT NULL DEFAULT 1,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    credentials_user TEXT,
    credentials_pass TEXT,
    endpoint TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_circle_sessions_circle_id ON public.circle_sessions(circle_id);
CREATE INDEX IF NOT EXISTS idx_circle_sessions_buyer_id ON public.circle_sessions(buyer_id);
CREATE INDEX IF NOT EXISTS idx_circle_sessions_provider_id ON public.circle_sessions(provider_id);

CREATE TABLE IF NOT EXISTS public.circle_revenues (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    circle_id UUID NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
    provider_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    quote_id UUID REFERENCES public.circle_quotes(id) ON DELETE SET NULL,
    session_id UUID REFERENCES public.circle_sessions(id) ON DELETE SET NULL,
    amount DOUBLE PRECISION NOT NULL,
    revenue_type VARCHAR(50) NOT NULL DEFAULT 'usage',
    claimed BOOLEAN NOT NULL DEFAULT FALSE,
    claimed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_circle_revenues_circle_id ON public.circle_revenues(circle_id);
CREATE INDEX IF NOT EXISTS idx_circle_revenues_provider_id ON public.circle_revenues(provider_id);
CREATE INDEX IF NOT EXISTS idx_circle_revenues_claimed ON public.circle_revenues(claimed);