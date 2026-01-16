"use client";

import { useState, useEffect } from "react";

// Types
interface Notification {
    id: string;
    type: "follow" | "order" | "review" | "message" | "badge";
    title: string;
    message: string;
    read: boolean;
    created_at: string;
    link?: string;
}

// Mock notifications
const mockNotifications: Notification[] = [
    { id: "1", type: "order", title: "New Sale!", message: "buyer_jane purchased 50 GB from your listing", read: false, created_at: "2 min ago", link: "/dashboard/sales" },
    { id: "2", type: "follow", title: "New Follower", message: "@tech_sam started following you", read: false, created_at: "1 hour ago", link: "/profile/tech_sam" },
    { id: "3", type: "review", title: "New Review", message: "You received a 5-star review!", read: true, created_at: "3 hours ago", link: "/profile" },
    { id: "4", type: "message", title: "New Message", message: "kwame_buyer sent you a message", read: true, created_at: "1 day ago", link: "/messages" },
    { id: "5", type: "badge", title: "Badge Earned!", message: "You earned the 'Top Seller' badge", read: true, created_at: "2 days ago", link: "/profile" },
];

export function NotificationBell() {
    const [isOpen, setIsOpen] = useState(false);
    const [notifications, setNotifications] = useState<Notification[]>(mockNotifications);

    const unreadCount = notifications.filter(n => !n.read).length;

    const markAllRead = () => {
        setNotifications(notifications.map(n => ({ ...n, read: true })));
    };

    const getIcon = (type: string) => {
        switch (type) {
            case "order":
                return (
                    <svg className="w-4 h-4" style={{ color: "var(--success)" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                );
            case "follow":
                return (
                    <svg className="w-4 h-4" style={{ color: "var(--primary)" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                );
            case "review":
                return <span className="text-yellow-500 text-sm">★</span>;
            case "message":
                return (
                    <svg className="w-4 h-4" style={{ color: "var(--info)" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                );
            case "badge":
                return (
                    <svg className="w-4 h-4" style={{ color: "var(--warning)" }} fill="currentColor" viewBox="0 0 20 20">
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                );
            default:
                return null;
        }
    };

    return (
        <div className="relative">
            {/* Bell Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="relative p-2 rounded-lg transition-colors hover:bg-gray-100 dark:hover:bg-neutral-800"
            >
                <svg className="w-5 h-5" style={{ color: "var(--foreground)" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>

                {/* Badge */}
                {unreadCount > 0 && (
                    <span
                        className="absolute top-1 right-1 w-4 h-4 rounded-full text-xs flex items-center justify-center"
                        style={{ background: "var(--primary)", color: "white" }}
                    >
                        {unreadCount}
                    </span>
                )}
            </button>

            {/* Dropdown */}
            {isOpen && (
                <>
                    {/* Overlay */}
                    <div
                        className="fixed inset-0 z-40"
                        onClick={() => setIsOpen(false)}
                    />

                    {/* Panel */}
                    <div
                        className="absolute right-0 mt-2 w-80 rounded-lg shadow-lg z-50 overflow-hidden"
                        style={{ background: "var(--card)", border: "1px solid var(--card-border)" }}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between p-3 border-b" style={{ borderColor: "var(--card-border)" }}>
                            <span className="font-semibold" style={{ color: "var(--foreground)" }}>
                                Notifications
                            </span>
                            {unreadCount > 0 && (
                                <button
                                    onClick={markAllRead}
                                    className="text-sm hover:underline"
                                    style={{ color: "var(--primary)" }}
                                >
                                    Mark all read
                                </button>
                            )}
                        </div>

                        {/* List */}
                        <div className="max-h-80 overflow-y-auto">
                            {notifications.length === 0 ? (
                                <div className="p-4 text-center" style={{ color: "var(--muted)" }}>
                                    No notifications
                                </div>
                            ) : (
                                notifications.map((notif) => (
                                    <a
                                        key={notif.id}
                                        href={notif.link || "#"}
                                        className="flex gap-3 p-3 border-b last:border-b-0 transition-colors hover:bg-gray-50 dark:hover:bg-neutral-800"
                                        style={{
                                            borderColor: "var(--card-border)",
                                            background: notif.read ? "transparent" : "rgba(249, 115, 22, 0.05)",
                                        }}
                                        onClick={() => setIsOpen(false)}
                                    >
                                        <div
                                            className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                                            style={{ background: "var(--background)" }}
                                        >
                                            {getIcon(notif.type)}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span
                                                    className="font-medium text-sm truncate"
                                                    style={{ color: "var(--foreground)" }}
                                                >
                                                    {notif.title}
                                                </span>
                                                {!notif.read && (
                                                    <span
                                                        className="w-2 h-2 rounded-full flex-shrink-0"
                                                        style={{ background: "var(--primary)" }}
                                                    />
                                                )}
                                            </div>
                                            <p
                                                className="text-sm truncate"
                                                style={{ color: "var(--muted)" }}
                                            >
                                                {notif.message}
                                            </p>
                                            <span
                                                className="text-xs"
                                                style={{ color: "var(--muted)" }}
                                            >
                                                {notif.created_at}
                                            </span>
                                        </div>
                                    </a>
                                ))
                            )}
                        </div>

                        {/* Footer */}
                        <a
                            href="/notifications"
                            className="block p-3 text-center text-sm border-t transition-colors hover:bg-gray-50 dark:hover:bg-neutral-800"
                            style={{ borderColor: "var(--card-border)", color: "var(--primary)" }}
                        >
                            View all notifications
                        </a>
                    </div>
                </>
            )}
        </div>
    );
}

// Full Notifications Page Component
export default function NotificationsPage() {
    const [notifications, setNotifications] = useState<Notification[]>(mockNotifications);
    const [filter, setFilter] = useState<"all" | "unread">("all");

    const filtered = filter === "unread"
        ? notifications.filter(n => !n.read)
        : notifications;

    const markAsRead = (id: string) => {
        setNotifications(notifications.map(n =>
            n.id === id ? { ...n, read: true } : n
        ));
    };

    return (
        <div className="min-h-screen" style={{ background: "var(--background)" }}>
            <div className="container py-8 max-w-2xl">
                <div className="flex items-center justify-between mb-6">
                    <h1 className="text-2xl font-bold" style={{ color: "var(--foreground)" }}>
                        Notifications
                    </h1>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setFilter("all")}
                            className={`btn text-sm ${filter === "all" ? "btn-primary" : "btn-secondary"}`}
                        >
                            All
                        </button>
                        <button
                            onClick={() => setFilter("unread")}
                            className={`btn text-sm ${filter === "unread" ? "btn-primary" : "btn-secondary"}`}
                        >
                            Unread
                        </button>
                    </div>
                </div>

                <div className="card">
                    {filtered.length === 0 ? (
                        <div className="py-8 text-center" style={{ color: "var(--muted)" }}>
                            No notifications
                        </div>
                    ) : (
                        filtered.map((notif) => (
                            <a
                                key={notif.id}
                                href={notif.link || "#"}
                                onClick={() => markAsRead(notif.id)}
                                className="flex gap-4 p-4 border-b last:border-b-0 transition-colors hover:bg-gray-50 dark:hover:bg-neutral-800 -mx-6 px-6"
                                style={{
                                    borderColor: "var(--card-border)",
                                    background: notif.read ? "transparent" : "rgba(249, 115, 22, 0.05)",
                                }}
                            >
                                <div
                                    className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                                    style={{ background: "var(--background)" }}
                                >
                                    {/* Icon based on type */}
                                    <span className="text-lg">
                                        {notif.type === "order" && "💰"}
                                        {notif.type === "follow" && "👤"}
                                        {notif.type === "review" && "⭐"}
                                        {notif.type === "message" && "💬"}
                                        {notif.type === "badge" && "🏆"}
                                    </span>
                                </div>
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="font-medium" style={{ color: "var(--foreground)" }}>
                                            {notif.title}
                                        </span>
                                        {!notif.read && (
                                            <span className="badge">New</span>
                                        )}
                                    </div>
                                    <p style={{ color: "var(--muted)" }}>{notif.message}</p>
                                    <span className="text-sm" style={{ color: "var(--muted)" }}>
                                        {notif.created_at}
                                    </span>
                                </div>
                            </a>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
