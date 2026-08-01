'use client';

import { Trophy, Zap, Crown, Footprints, Hammer, Gift, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/patterns/Modal';

interface Milestone {
  id: string;
  type: string;
  threshold_gb: number;
  badge_name: string;
  reward_amount: number;
  provider_name?: string;
}

interface MilestoneCelebrationProps {
  milestone: Milestone | null;
  onClose: () => void;
  onClaim?: () => void;
  onShare?: () => void;
}

const milestoneIcons: Record<string, React.ReactNode> = {
  first_gb: <Footprints className="h-10 w-10 text-[var(--success)]" aria-hidden />,
  ten_gb: <Zap className="h-10 w-10 text-[var(--warning)]" aria-hidden />,
  hundred_gb: <Trophy className="h-10 w-10 text-[var(--warning)]" aria-hidden />,
  five_hundred_gb: <Hammer className="h-10 w-10 text-[var(--info)]" aria-hidden />,
  tb_club: <Crown className="h-10 w-10 text-[var(--warning)]" aria-hidden />,
};

const milestoneMessages: Record<string, string> = {
  first_gb: "You've taken your first steps.",
  ten_gb: "You're becoming a power user.",
  hundred_gb: "You're a bandwidth champion.",
  five_hundred_gb: "You're a heavy hitter.",
  tb_club: 'Welcome to the 1TB club.',
};

/**
 * Milestone celebration — restrained Modal (no confetti overlay).
 * Reconstruction plan §23.2 bans decorative celebrations.
 */
export function MilestoneCelebration({
  milestone,
  onClose,
  onClaim,
  onShare,
}: MilestoneCelebrationProps) {
  if (!milestone) return null;

  const icon = milestoneIcons[milestone.type] || (
    <Trophy className="h-10 w-10 text-[var(--success)]" aria-hidden />
  );
  const message = milestoneMessages[milestone.type] || 'Milestone achieved.';
  const hasReward = milestone.reward_amount > 0;

  return (
    <Modal
      open={!!milestone}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`${milestone.threshold_gb} GB milestone`}
      description={message}
      footer={
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-end">
          {hasReward && onClaim ? (
            <Button type="button" onClick={onClaim}>
              <Gift className="mr-2 h-4 w-4" aria-hidden />
              Claim reward
            </Button>
          ) : null}
          {onShare ? (
            <Button type="button" variant="outline" onClick={onShare}>
              <Share2 className="mr-2 h-4 w-4" aria-hidden />
              Share
            </Button>
          ) : null}
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--success)_30%,var(--border))] bg-[color-mix(in_srgb,var(--success)_10%,transparent)]">
          {icon}
        </div>

        {milestone.badge_name ? (
          <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-border bg-secondary p-3">
            <Trophy className="h-5 w-5 text-[var(--warning)]" aria-hidden />
            <div>
              <p className="text-xs text-muted-foreground">Badge earned</p>
              <p className="text-sm font-semibold text-foreground">{milestone.badge_name}</p>
            </div>
          </div>
        ) : null}

        {hasReward ? (
          <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--success)_30%,var(--border))] bg-[color-mix(in_srgb,var(--success)_8%,transparent)] p-3">
            <Gift className="h-5 w-5 text-[var(--success)]" aria-hidden />
            <div>
              <p className="text-xs text-muted-foreground">Reward</p>
              <p className="font-mono text-sm font-semibold text-[var(--success)]">
                {milestone.reward_amount.toFixed(6)} SOL credit
              </p>
            </div>
          </div>
        ) : null}

        {milestone.provider_name ? (
          <p className="text-center text-sm text-muted-foreground">
            with @{milestone.provider_name}
          </p>
        ) : null}

        {milestone.threshold_gb >= 10 ? (
          <div className="border-t border-border pt-4 text-center">
            <p className="mb-2 text-sm text-muted-foreground">
              How was your experience with this proxy?
            </p>
            <Button
              type="button"
              variant="link"
              onClick={() => {
                onClose();
                window.location.href = `/sessions/${milestone.id}/review`;
              }}
            >
              Write a review
            </Button>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

export default MilestoneCelebration;
