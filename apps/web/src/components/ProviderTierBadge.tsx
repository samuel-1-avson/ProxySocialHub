'use client';

import { Shield, CheckCircle, Star, Crown, ShieldOff } from 'lucide-react';

export type ProviderTier = 'Bronze' | 'Silver' | 'Gold' | 'unverified' | 'basic' | 'verified' | 'premium' | 'enterprise';

interface Props {
  tier: ProviderTier | string;
  score?: number;
  className?: string;
}

interface TierConfig {
  label: string;
  icon: React.ReactNode;
  badgeClass: string;
  textClass: string;
}

const TIER_CONFIG: Record<string, TierConfig> = {
  Bronze: {
    label: 'Bronze',
    icon: <Shield size={12} />,
    badgeClass: 'bg-orange-900/30 border border-orange-700/50',
    textClass: 'text-orange-400',
  },
  Silver: {
    label: 'Silver',
    icon: <CheckCircle size={12} />,
    badgeClass: 'bg-slate-800/60 border border-slate-500/50',
    textClass: 'text-slate-300',
  },
  Gold: {
    label: 'Gold',
    icon: <Crown size={12} />,
    badgeClass: 'bg-amber-900/40 border border-amber-500/50 shadow-lg shadow-amber-500/10',
    textClass: 'text-amber-400',
  },
  unverified: {
    label: 'Unverified',
    icon: <ShieldOff size={12} />,
    badgeClass: 'bg-gray-800 border border-gray-600',
    textClass: 'text-gray-400',
  },
  basic: {
    label: 'Bronze', // Mapping for legacy
    icon: <Shield size={12} />,
    badgeClass: 'bg-blue-900/60 border border-blue-600/50',
    textClass: 'text-blue-300',
  },
  verified: {
    label: 'Silver', // Mapping for legacy
    icon: <CheckCircle size={12} />,
    badgeClass: 'bg-green-900/60 border border-green-600/50',
    textClass: 'text-green-300',
  },
  premium: {
    label: 'Gold', // Mapping for legacy
    icon: <Star size={12} />,
    badgeClass: 'bg-violet-900/60 border border-violet-500/50',
    textClass: 'text-violet-300',
  },
  enterprise: {
    label: 'Gold', // Mapping for legacy
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
