'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, UserCheck, UserPlus } from 'lucide-react';
import { followUser, unfollowUser } from '@/lib/social-api';
import { useAuth } from '@/lib/auth';
import { useNotificationStore, useToast } from '@/stores';

interface FollowProviderButtonProps {
    providerId: string;
    providerName?: string;
    isFollowed?: boolean;
    onFollowChange?: (followed: boolean) => void;
    compact?: boolean;
    className?: string;
    showFeedHint?: boolean;
}

export function FollowProviderButton({
    providerId,
    providerName,
    isFollowed = false,
    onFollowChange,
    compact = false,
    className = '',
    showFeedHint = true,
}: FollowProviderButtonProps) {
    const { user, isAuthenticated } = useAuth();
    const toast = useToast();
    const addNotification = useNotificationStore((s) => s.addNotification);
    const [followed, setFollowed] = useState(isFollowed);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        setFollowed(isFollowed);
    }, [isFollowed]);

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
                if (showFeedHint) {
                    addNotification({
                        type: 'success',
                        title: `Following ${label}`,
                        message:
                            'New listings and milestones from providers you follow appear on your activity feed.',
                        action: {
                            label: 'Open feed',
                            onClick: () => {
                                window.location.href = '/community/feed';
                            },
                        },
                    });
                } else {
                    toast.success('Following', `You are now following ${label}.`);
                }
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
            title={followed ? 'Unfollow provider' : 'Follow for personalized feed'}
            className={`inline-flex items-center justify-center gap-2 rounded-lg border font-black uppercase tracking-widest transition-colors disabled:opacity-50 ${
                compact
                    ? 'py-2 px-3 text-[9px]'
                    : 'py-2.5 px-3 text-[10px]'
            } ${
                followed
                    ? 'border-white/10 bg-white/5 text-muted-foreground hover:text-foreground'
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
        <p className={`text-[9px] font-mono text-muted-foreground/40 uppercase tracking-wider ${className}`}>
            Follow providers to see their listings on{' '}
            <Link href="/community/feed" className="text-primary/80 hover:text-primary">
                your feed
            </Link>
            .
        </p>
    );
}
