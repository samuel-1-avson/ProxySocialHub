"use client";

import { useRef, useCallback } from "react";
import type { Notification } from "@/lib/notifications-api";
import { getNotificationTypeLabel, NotificationType } from "@/lib/notifications-api";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import {
    Heart,
    UserPlus,
    MessageSquare,
    Package,
    Coins,
    Award,
    AlertTriangle,
    Bell,
    Check,
    Loader2,
} from "lucide-react";

const notificationIcons: Record<string, React.ReactNode> = {
    [NotificationType.NewFollower]: <Heart className="w-4 h-4 text-rose-500" />,
    [NotificationType.NewFriendRequest]: <UserPlus className="w-4 h-4 text-blue-500" />,
    [NotificationType.Message]: <MessageSquare className="w-4 h-4 text-primary" />,
    [NotificationType.NewOrder]: <Package className="w-4 h-4 text-amber-500" />,
    [NotificationType.PaymentReceived]: <Coins className="w-4 h-4 text-green-500" />,
    [NotificationType.BadgeEarned]: <Award className="w-4 h-4 text-purple-500" />,
    [NotificationType.SecurityAlert]: <AlertTriangle className="w-4 h-4 text-red-500" />,
    [NotificationType.TierUpgrade]: <Award className="w-4 h-4 text-yellow-500" />,
    [NotificationType.ShowcaseFeatured]: <Bell className="w-4 h-4 text-cyan-500" />,
};

interface VirtualizedNotificationListProps {
    notifications: Notification[];
    onMarkAsRead: (id: string) => void;
    onMarkAllAsRead: () => void;
    hasMore: boolean;
    isLoadingMore: boolean;
    onLoadMore: () => void;
}

const ITEM_HEIGHT = 72;
const OVERSCAN = 5;

export function VirtualizedNotificationList({
    notifications,
    onMarkAsRead,
    onMarkAllAsRead,
    hasMore,
    isLoadingMore,
    onLoadMore,
}: VirtualizedNotificationListProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const observerRef = useRef<IntersectionObserver | null>(null);

    const lastItemRef = useCallback(
        (node: HTMLDivElement | null) => {
            if (isLoadingMore) return;
            if (observerRef.current) observerRef.current.disconnect();

            observerRef.current = new IntersectionObserver((entries) => {
                if (entries[0].isIntersecting && hasMore) {
                    onLoadMore();
                }
            });

            if (node) observerRef.current.observe(node);
        },
        [isLoadingMore, hasMore, onLoadMore]
    );

    if (notifications.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-12 text-center">
                <Bell className="w-12 h-12 text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground">No notifications yet</p>
            </div>
        );
    }

    return (
        <div ref={containerRef} className="space-y-1">
            {notifications.map((notification, index) => {
                const isLast = index === notifications.length - 1;
                const icon = notificationIcons[notification.type] || <Bell className="w-4 h-4" />;

                return (
                    <div
                        key={notification.id}
                        ref={isLast ? lastItemRef : null}
                        data-notification-id={notification.id}
                        className={`
                            group flex items-start gap-3 p-3 rounded-lg cursor-pointer
                            transition-colors duration-200
                            ${notification.isRead
                                ? "bg-background hover:bg-muted/50"
                                : "bg-primary/5 hover:bg-primary/10 border-l-2 border-l-primary"
                            }
                        `}
                        onClick={() => !notification.isRead && onMarkAsRead(notification.id)}
                    >
                        {/* Avatar or Icon */}
                        <div className="relative shrink-0">
                            {notification.actor ? (
                                <img
                                    src={notification.actor.avatar || "/default-avatar.png"}
                                    alt={notification.actor.displayName}
                                    className="w-10 h-10 rounded-full object-cover ring-2 ring-background"
                                />
                            ) : (
                                <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                                    {icon}
                                </div>
                            )}
                            {/* Notification type indicator */}
                            <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-background flex items-center justify-center">
                                {icon}
                            </div>
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                            <p className="text-sm leading-relaxed">
                                {notification.actor && (
                                    <Link
                                        href={`/providers/${notification.actor.id}`}
                                        className="font-medium hover:underline"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        {notification.actor.displayName}
                                    </Link>
                                )}{" "}
                                <span className="text-muted-foreground">
                                    {notification.message}
                                </span>
                            </p>

                            {/* Related entity link */}
                            {notification.entityType && notification.entityId && (
                                <Link
                                    href={getEntityLink(notification.entityType, notification.entityId)}
                                    className="text-xs text-primary hover:underline mt-1 inline-block"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    View {notification.entityType.toLowerCase()}
                                </Link>
                            )}

                            {/* Timestamp and actions */}
                            <div className="flex items-center gap-2 mt-1.5">
                                <span className="text-xs text-muted-foreground">
                                    {formatDistanceToNow(new Date(notification.createdAt), {
                                        addSuffix: true,
                                    })}
                                </span>
                                {!notification.isRead && (
                                    <>
                                        <span className="w-1 h-1 rounded-full bg-primary" />
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onMarkAsRead(notification.id);
                                            }}
                                            className="text-xs text-primary hover:underline flex items-center gap-1"
                                        >
                                            <Check className="w-3 h-3" />
                                            Mark as read
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Unread indicator */}
                        {!notification.isRead && (
                            <div className="w-2 h-2 rounded-full bg-primary mt-2" />
                        )}
                    </div>
                );
            })}

            {/* Loading indicator */}
            {isLoadingMore && (
                <div className="flex justify-center py-4">
                    <Loader2 className="w-5 h-5 animate-spin text-primary" />
                </div>
            )}

            {/* Mark all as read button */}
            {notifications.some((n) => !n.isRead) && (
                <button
                    onClick={onMarkAllAsRead}
                    className="w-full py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                    Mark all as read
                </button>
            )}
        </div>
    );
}

function getEntityLink(type: string, id: string): string {
    switch (type) {
        case "PROVIDER":
            return `/providers/${id}`;
        case "NODE":
            return `/nodes/${id}`;
        case "ORDER":
            return `/orders/${id}`;
        case "FORUM_POST":
            return `/forum/post/${id}`;
        case "MESSAGE":
            return `/messages?conversation=${id}`;
        default:
            return `#`;
    }
}
