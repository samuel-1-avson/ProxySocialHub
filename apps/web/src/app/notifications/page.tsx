"use client";

import { useState, useEffect } from "react";
import { ShoppingBag, User, Star, MessageSquare, Award, Bell } from "lucide-react";

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
                return <ShoppingBag className="w-4 h-4" style={{ color: "var(--success)" }} />;
            case "follow":
                return <User className="w-4 h-4" style={{ color: "var(--primary)" }} />;
            case "review":
                return <Star className="w-4 h-4 text-yellow-500 fill-current" />;
            case "message":
                return <MessageSquare className="w-4 h-4" style={{ color: "var(--info)" }} />;
            case "badge":
                return <Award className="w-4 h-4" style={{ color: "var(--warning)" }} />;
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
                <Bell className="w-5 h-5" style={{ color: "var(--foreground)" }} />

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
                                    <span className="flex items-center justify-center w-full h-full">
                                        {notif.type === "order" && <ShoppingBag className="w-5 h-5 text-green-500" />}
                                        {notif.type === "follow" && <User className="w-5 h-5 text-blue-500" />}
                                        {notif.type === "review" && <Star className="w-5 h-5 text-yellow-500 fill-current" />}
                                        {notif.type === "message" && <MessageSquare className="w-5 h-5 text-indigo-500" />}
                                        {notif.type === "badge" && <Award className="w-5 h-5 text-orange-500" />}
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
