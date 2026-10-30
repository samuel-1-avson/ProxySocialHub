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
    badgeClass: 'bg-warning/30 border border-warning/50',
    textClass: 'text-warning',
  },
  Silver: {
    label: 'Silver',
    icon: <CheckCircle size={12} />,
    badgeClass: 'bg-secondary/60 border border-border',
    textClass: 'text-muted-foreground',
  },
  Gold: {
    label: 'Gold',
    icon: <Crown size={12} />,
    badgeClass: 'bg-warning/40 border border-warning/50 shadow-sm',
    textClass: 'text-warning',
  },
  unverified: {
    label: 'Unverified',
    icon: <ShieldOff size={12} />,
    badgeClass: 'bg-secondary border border-border',
    textClass: 'text-muted-foreground',
  },
  basic: {
    label: 'Bronze', // Mapping for legacy
    icon: <Shield size={12} />,
    badgeClass: 'bg-info/60 border border-info/50',
    textClass: 'text-info',
  },
  verified: {
    label: 'Silver', // Mapping for legacy
    icon: <CheckCircle size={12} />,
    badgeClass: 'bg-success/60 border border-success/50',
    textClass: 'text-success',
  },
  premium: {
    label: 'Gold', // Mapping for legacy
    icon: <Star size={12} />,
    badgeClass: 'bg-primary/60 border border-primary/50',
    textClass: 'text-primary',
  },
  enterprise: {
    label: 'Gold', // Mapping for legacy
    icon: <Crown size={12} />,
    badgeClass: 'bg-warning/60 border border-warning/50',
    textClass: 'text-warning',
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
