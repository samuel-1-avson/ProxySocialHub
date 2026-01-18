-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- PROFILES (Syncs with auth.users)
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'buyer' CHECK (role IN ('buyer', 'provider', 'admin')),
    trust_tier VARCHAR(50) DEFAULT 'new',
    
    -- Social Profile
    username VARCHAR(50) UNIQUE,
    display_name VARCHAR(100),
    bio TEXT,
    avatar_url TEXT,
    cover_image_url TEXT,
    location VARCHAR(100),
    website VARCHAR(255),
    
    -- Stats
    followers_count INT DEFAULT 0,
    following_count INT DEFAULT 0,
    reviews_count INT DEFAULT 0,
    avg_rating NUMERIC(3, 2) DEFAULT 0,
    verified BOOLEAN DEFAULT FALSE,
    
    -- Business/Provider
    kyc_status VARCHAR(50) DEFAULT 'not_started',
    provider_since TIMESTAMP WITH TIME ZONE,
    total_bandwidth_sold NUMERIC(20, 2) DEFAULT 0,
    wallet_address VARCHAR(42),

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Trigger to create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role)
  VALUES (new.id, new.email, COALESCE(new.raw_user_meta_data->>'role', 'buyer'));
  return new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- WALLETS
CREATE TABLE public.wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    balance NUMERIC(20, 4) NOT NULL DEFAULT 0,
    currency VARCHAR(3) NOT NULL DEFAULT 'GHS',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- WALLET LEDGER
CREATE TABLE public.wallet_ledger_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_id UUID NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
    amount NUMERIC(20, 4) NOT NULL,
    balance_after NUMERIC(20, 4) NOT NULL,
    type VARCHAR(50) NOT NULL, -- 'topup', 'usage_charge', 'payout', 'refund'
    reference_id VARCHAR(255),
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- NODES
CREATE TABLE public.nodes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    label VARCHAR(50),
    ip_address VARCHAR(45),
    status VARCHAR(50) DEFAULT 'offline',
    trust_score NUMERIC(3, 2) DEFAULT 1.0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- SESSIONS
CREATE TABLE public.sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    node_id UUID REFERENCES public.nodes(id) ON DELETE SET NULL,
    type VARCHAR(50) NOT NULL,
    status VARCHAR(50) DEFAULT 'active',
    credentials_user VARCHAR(255),
    credentials_pass VARCHAR(255),
    config JSONB,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- CIRCLES
CREATE TABLE public.circles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    description TEXT,
    is_public BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE public.circle_members (
    circle_id UUID REFERENCES public.circles(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    role VARCHAR(50) DEFAULT 'member',
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (circle_id, user_id)
);

-- Enable RLS (Row Level Security) - Basic Policy
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public profiles are viewable by everyone" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can insert their own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Indexes
CREATE INDEX idx_profiles_email ON public.profiles(email);
CREATE INDEX idx_sessions_user_id ON public.sessions(user_id);
CREATE INDEX idx_wallets_user_id ON public.wallets(user_id);
