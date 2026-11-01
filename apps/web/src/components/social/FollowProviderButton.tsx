'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Loader2, UserCheck, UserPlus } from 'lucide-react';
import { followUser, unfollowUser } from '@/lib/social-api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/stores';

interface FollowProviderButtonProps {
    providerId: string;
    providerName?: string;
    isFollowed?: boolean;
    onFollowChange?: (followed: boolean) => void;
    compact?: boolean;
    className?: string;
    showFeedHint?: boolean;
}

export function FollowProviderButton(props: FollowProviderButtonProps) {
    return <FollowProviderControl key={props.providerId + ":" + Boolean(props.isFollowed)} {...props} />;
}
function FollowProviderControl({
    providerId,
    providerName,
    isFollowed = false,
    onFollowChange,
    compact = false,
    className = '',
}: FollowProviderButtonProps) {
    const { user, isAuthenticated } = useAuth();
    const toast = useToast();
    const [followed, setFollowed] = useState(isFollowed);
    const [busy, setBusy] = useState(false);


    if (!providerId || (user?.id && user.id === providerId)) {
        return null;
    }

    const handleClick = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        if (!isAuthenticated) {
            toast.warning('Sign in required', 'Sign in to follow providers and personalize your feed.');
            return;
        }

        setBusy(true);
        try {
            if (followed) {
                await unfollowUser(providerId);
                setFollowed(false);
                onFollowChange?.(false);
                toast.info('Unfollowed', `You will see fewer updates from ${providerName || 'this provider'}.`);
            } else {
                await followUser(providerId);
                setFollowed(true);
                onFollowChange?.(true);
                const label = providerName || 'this provider';
                toast.success('Following', `You are now following ${label}.`);
            }
        } catch (err) {
            toast.error('Follow failed', err instanceof Error ? err.message : 'Please try again.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <button
            type="button"
            onClick={handleClick}
            disabled={busy}
            aria-pressed={followed}
            aria-label={(followed ? 'Unfollow ' : 'Follow ') + (providerName || 'provider')}
            title={followed ? 'Unfollow provider' : 'Follow provider'}
            className={`inline-flex items-center justify-center gap-2 rounded-lg border font-semibold transition-colors disabled:opacity-50 ${
                compact
                    ? 'py-2 px-3 text-xs'
                    : 'py-2.5 px-3 text-sm'
            } ${
                followed
                    ? 'border-border bg-secondary text-muted-foreground hover:text-foreground'
                    : 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/20'
            } ${className}`}
        >
            {busy ? (
                <Loader2 size={14} className="animate-spin" />
            ) : followed ? (
                <UserCheck size={14} />
            ) : (
                <UserPlus size={14} />
            )}
            {followed ? 'Following' : 'Follow'}
        </button>
    );
}

/** Inline hint shown near follow actions on marketplace surfaces. */
export function FollowFeedHint({ className = '' }: { className?: string }) {
    return (
        <p className={`text-xs leading-relaxed text-muted-foreground ${className}`}>
            Find current offers and availability in the{' '}
            <Link href="/marketplace" className="ui-link">marketplace</Link>.
        </p>
    );
}
