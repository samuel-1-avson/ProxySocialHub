'use client';

import { Shield, CheckCircle, Star, Crown, ShieldOff } from 'lucide-react';

export type ProviderTier = 'unverified' | 'basic' | 'verified' | 'premium' | 'enterprise';

interface Props {
  tier: ProviderTier;
  score?: number;
  className?: string;
}

interface TierConfig {
  label: string;
  icon: React.ReactNode;
  badgeClass: string;
  textClass: string;
}

const TIER_CONFIG: Record<ProviderTier, TierConfig> = {
  unverified: {
    label: 'Unverified',
    icon: <ShieldOff size={12} />,
    badgeClass: 'bg-gray-800 border border-gray-600',
    textClass: 'text-gray-400',
  },
  basic: {
    label: 'Basic',
    icon: <Shield size={12} />,
    badgeClass: 'bg-blue-900/60 border border-blue-600/50',
    textClass: 'text-blue-300',
  },
  verified: {
    label: 'Verified',
    icon: <CheckCircle size={12} />,
    badgeClass: 'bg-green-900/60 border border-green-600/50',
    textClass: 'text-green-300',
  },
  premium: {
    label: 'Premium',
    icon: <Star size={12} />,
    badgeClass: 'bg-violet-900/60 border border-violet-500/50',
    textClass: 'text-violet-300',
  },
  enterprise: {
    label: 'Enterprise',
    icon: <Crown size={12} />,
    badgeClass: 'bg-amber-900/60 border border-amber-500/50',
    textClass: 'text-amber-300',
  },
};

export function ProviderTierBadge({ tier, score, className = '' }: Props) {
  const config = TIER_CONFIG[tier] ?? TIER_CONFIG.unverified;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${config.badgeClass} ${config.textClass} ${className}`}
      title={score !== undefined ? `Tier score: ${score.toFixed(1)}` : undefined}
    >
      {config.icon}
      <span>{config.label}</span>
      {score !== undefined && (
        <span className="opacity-70 ml-0.5">({score.toFixed(0)})</span>
      )}
    </span>
  );
}

export default ProviderTierBadge;
