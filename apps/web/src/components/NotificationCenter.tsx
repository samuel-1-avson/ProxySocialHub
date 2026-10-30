"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { useRealtime } from "@/lib/websocket";
import {
    getNotifications,
    getUnreadCount,
    markNotificationRead,
    markAllNotificationsRead,
    type Notification,
} from "@/lib/notifications-api";
import { useKeyboardNavigation, useFocusTrap } from "@/hooks/useKeyboardNavigation";
import { announce, generateId } from "@/utils/a11y";
import {
    Bell,
    CheckCheck,
    Settings,
    Loader2,
    ChevronRight,
} from "lucide-react";
import { VirtualizedNotificationList } from "./virtualized/VirtualizedNotificationList";
import { ROUTES } from "@/lib/navigation/routes";

function isNotificationPayload(value: unknown): value is Notification {
    return (
        typeof value === "object" &&
        value !== null &&
        "id" in value &&
        "title" in value &&
        typeof value.id === "string" &&
        typeof value.title === "string"
    );
}

export function NotificationCenter() {
    const { isAuthenticated } = useAuth();
    const { subscribe, isConnected } = useRealtime();
    const [isOpen, setIsOpen] = useState(false);
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [loading, setLoading] = useState(false);
    const [markingReadId, setMarkingReadId] = useState<string | null>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const dropdownId = useRef(generateId("notification-dropdown"));
    const buttonId = useRef(generateId("notification-button"));

    // Focus trap for dropdown
    const dropdownRef = useFocusTrap<HTMLDivElement>(isOpen);

    // Keyboard navigation
    const { handleKeyDown } = useKeyboardNavigation({
        onEscape: () => setIsOpen(false),
    });

    // Fetch notifications when opened
    const fetchNotifications = useCallback(async () => {
        if (!isAuthenticated) return;
        setLoading(true);
        try {
            const data = await getNotifications({ limit: 100 });
            setNotifications(data.notifications || []);
        } catch (err) {
            console.error("Failed to fetch notifications:", err);
        } finally {
            setLoading(false);
        }
    }, [isAuthenticated]);

    // Fetch unread count
    const fetchUnreadCount = useCallback(async () => {
        if (!isAuthenticated) return;
        try {
            const data = await getUnreadCount();
            setUnreadCount(data.count || 0);
        } catch (err) {
            console.error("Failed to fetch unread count:", err);
        }
    }, [isAuthenticated]);

    // Initial fetch
    useEffect(() => {
        if (isAuthenticated) {
            fetchUnreadCount();
            const interval = setInterval(fetchUnreadCount, 30000);
            return () => clearInterval(interval);
        }
    }, [isAuthenticated, fetchUnreadCount]);

    // Fetch when opened
    useEffect(() => {
        if (isOpen) {
            fetchNotifications();
        }
    }, [isOpen, fetchNotifications]);

    // WebSocket listener for real-time notifications
    useEffect(() => {
        if (!isAuthenticated) return;

        return subscribe("notification", (message) => {
            const payload = message.data?.payload ?? message.data;

            if (isNotificationPayload(payload)) {
                setNotifications((prev) => [payload, ...prev]);
            } else if (isOpen) {
                void fetchNotifications();
            }

            void fetchUnreadCount();
            announce(
                `New notification: ${isNotificationPayload(payload) ? payload.title : "Update received"}`,
                "polite"
            );
        });
    }, [fetchNotifications, fetchUnreadCount, isAuthenticated, isOpen, subscribe]);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (
                dropdownRef.current &&
                !dropdownRef.current.contains(event.target as Node) &&
                !buttonRef.current?.contains(event.target as Node)
            ) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener("mousedown", handleClickOutside);
        }
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [isOpen, dropdownRef]);

    // Mark single notification as read
    const handleMarkRead = async (notificationId: string) => {
        setMarkingReadId(notificationId);
        try {
            await markNotificationRead(notificationId);
            setNotifications((prev) =>
                prev.map((n) =>
                    n.id === notificationId ? { ...n, is_read: true, read_at: new Date().toISOString() } : n
                )
            );
            setUnreadCount((prev) => Math.max(0, prev - 1));
        } catch (err) {
            console.error("Failed to mark as read:", err);
        } finally {
            setMarkingReadId(null);
        }
    };

    // Mark all as read
    const handleMarkAllRead = async () => {
        try {
            await markAllNotificationsRead();
            setNotifications((prev) =>
                prev.map((n) => ({ ...n, is_read: true, read_at: new Date().toISOString() }))
            );
            setUnreadCount(0);
            announce("All notifications marked as read", "polite");
        } catch (err) {
            console.error("Failed to mark all as read:", err);
        }
    };

    if (!isAuthenticated) return null;

    const unreadNotifications = notifications.filter((n) => !n.is_read);

    return (
        <div className="relative">
            {/* Bell Button */}
            <button
                ref={buttonRef}
                id={buttonId.current}
                onClick={() => setIsOpen(!isOpen)}
                onKeyDown={handleKeyDown}
                className="relative p-2 rounded-sm hover:bg-secondary/50 transition-colors group"
                aria-label={`Notifications ${unreadCount > 0 ? `(${unreadCount} unread)` : ""}`}
                aria-expanded={isOpen}
                aria-controls={dropdownId.current}
                aria-haspopup="menu"
            >
                <Bell
                    className={`w-5 h-5 transition-colors ${isOpen ? "text-primary" : "text-muted-foreground group-hover:text-foreground"}`}
                    aria-hidden="true"
                />
                {unreadCount > 0 && (
                    <span
                        className="absolute -top-0.5 -right-0.5 w-5 h-5 bg-primary text-primary-foreground text-xs font-bold font-mono rounded-full flex items-center justify-center animate-pulse"
                        aria-hidden="true"
                    >
                        {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                )}
                {isConnected && (
                    <span
                        className="absolute bottom-0.5 right-0.5 w-2 h-2 bg-success rounded-full border-2 border-background"
                        aria-hidden="true"
                    />
                )}
            </button>

            {/* Dropdown Panel */}
            {isOpen && (
                <div
                    ref={dropdownRef}
                    id={dropdownId.current}
                    role="menu"
                    aria-labelledby={buttonId.current}
                    className="absolute right-0 top-full mt-2 w-[400px] max-w-[calc(100vw-2rem)] bg-card border border-border rounded-lg shadow-sm z-50 overflow-hidden"
                    onKeyDown={handleKeyDown}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between p-4 border-b border-border bg-secondary/20">
                        <div className="flex items-center gap-2">
                            <Bell className="w-4 h-4 text-primary" aria-hidden="true" />
                            <h3 className="font-bold font-mono text-sm">NOTIFICATIONS</h3>
                            {unreadCount > 0 && (
                                <span className="px-2 py-0.5 bg-primary text-primary-foreground text-xs font-bold font-mono rounded-full">
                                    {unreadCount}
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-1">
                            {unreadCount > 0 && (
                                <button
                                    onClick={handleMarkAllRead}
                                    className="p-2 hover:bg-secondary/50 rounded-sm transition-colors"
                                    title="Mark all as read"
                                    aria-label="Mark all notifications as read"
                                >
                                    <CheckCheck className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                                </button>
                            )}
                            <Link
                                href={ROUTES.dashboardSettingsNotifications}
                                onClick={() => setIsOpen(false)}
                                className="p-2 hover:bg-secondary/50 rounded-sm transition-colors"
                                title="Notification settings"
                                aria-label="Notification settings"
                            >
                                <Settings className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                            </Link>
                        </div>
                    </div>

                    {/* Content */}
                    <div className="max-h-[400px]">
                        {loading ? (
                            <div className="flex items-center justify-center py-12" role="status">
                                <Loader2 className="w-6 h-6 animate-spin text-primary" aria-hidden="true" />
                                <span className="sr-only">Loading notifications...</span>
                            </div>
                        ) : notifications.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-12 px-4 text-center" role="status">
                                <Bell className="w-12 h-12 text-muted-foreground/20 mb-3" aria-hidden="true" />
                                <p className="text-sm font-mono text-muted-foreground">No notifications yet</p>
                                <p className="text-xs font-mono text-muted-foreground/50 mt-1">
                                    We&apos;ll notify you when something happens
                                </p>
                            </div>
                        ) : (
                            <VirtualizedNotificationList
                                notifications={notifications}
                                onMarkAsRead={handleMarkRead}
                                onMarkAllAsRead={handleMarkAllRead}
                                markingReadId={markingReadId}
                            />
                        )}
                    </div>

                    {/* Footer */}
                    <div className="p-3 border-t border-border bg-secondary/10">
                        <Link
                            href={ROUTES.dashboardSettingsNotifications}
                            onClick={() => setIsOpen(false)}
                            className="flex items-center justify-center gap-2 text-xs font-mono text-primary hover:text-primary/80 transition-colors"
                        >
                            View all notifications
                            <ChevronRight className="w-4 h-4" aria-hidden="true" />
                        </Link>
                    </div>
                </div>
            )}
        </div>
    );
}

export default NotificationCenter;
