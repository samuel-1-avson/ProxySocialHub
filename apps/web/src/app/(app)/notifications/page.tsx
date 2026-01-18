"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import {
    ShoppingBag,
    User,
    Star,
    MessageSquare,
    Award,
    Bell,
    Send,
    User as UserIcon,
    ShieldCheck,
    CheckCircle2,
    Clock,
    X
} from "lucide-react";
import { getNotifications } from "@/lib/social-api";
import { ProtectedRoute } from "@/components/ProtectedRoute";

// Types
export interface Notification {
    id: string;
    type: "follow" | "order" | "review" | "message" | "badge";
    title: string;
    message: string;
    read: boolean;
    created_at: string;
    link?: string;
}

export function NotificationBell() {
    const [isOpen, setIsOpen] = useState(false);
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchNotifs() {
            try {
                const data = await getNotifications();
                setNotifications(data.notifications || []);
            } catch (error) {
                console.error("Failed to load notifications", error);
            } finally {
                setLoading(false);
            }
        }
        fetchNotifs();
    }, []);

    const unreadCount = notifications.filter(n => !n.read).length;

    const markAllRead = () => {
        setNotifications(notifications.map(n => ({ ...n, read: true })));
    };

    const getIcon = (type: string) => {
        switch (type) {
            case "order": return <ShoppingBag size={14} className="text-green-400" />;
            case "follow": return <UserIcon size={14} className="text-blue-400" />;
            case "review": return <Star size={14} className="text-yellow-400 fill-current" />;
            case "message": return <MessageSquare size={14} className="text-primary" />;
            case "badge": return <Award size={14} className="text-orange-400" />;
            default: return <Bell size={14} className="text-muted-foreground" />;
        }
    };

    return (
        <div className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="group relative p-3 rounded-2xl bg-white/5 border border-white/5 hover:border-white/20 transition-all active:scale-95"
            >
                <Bell size={18} className="text-white/60 group-hover:text-primary transition-colors" />
                {unreadCount > 0 && (
                    <span className="absolute top-2 right-2 w-4 h-4 rounded-full bg-primary text-black text-[9px] font-black flex items-center justify-center border-2 border-[#050505] shadow-[0_0_10px_rgba(var(--primary-rgb),0.5)]">
                        {unreadCount}
                    </span>
                )}
            </button>

            {isOpen && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
                    <div className="absolute right-0 mt-4 w-96 rounded-3xl bg-[#0a0a0a]/90 border border-white/10 backdrop-blur-2xl shadow-[0_30px_60px_-15px_rgba(0,0,0,0.5)] z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        <div className="p-5 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                            <span className="text-xs font-black uppercase tracking-widest text-white/50">Pulse Notifications</span>
                            {unreadCount > 0 && (
                                <button
                                    onClick={markAllRead}
                                    className="text-[10px] font-black text-primary hover:underline uppercase tracking-widest"
                                >
                                    Clear Stream
                                </button>
                            )}
                        </div>

                        <div className="max-h-[450px] overflow-y-auto custom-scrollbar">
                            {loading ? (
                                <div className="p-12 text-center text-[10px] font-bold text-muted-foreground uppercase tracking-widest animate-pulse">Synchronizing...</div>
                            ) : notifications.length === 0 ? (
                                <div className="p-12 text-center space-y-4">
                                    <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mx-auto text-white/10">
                                        <Bell size={24} />
                                    </div>
                                    <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">No New Signals</p>
                                </div>
                            ) : (
                                notifications.map((notif) => (
                                    <a
                                        key={notif.id}
                                        href={notif.link || "#"}
                                        className={`flex gap-4 p-5 hover:bg-white/[0.03] transition-all border-b border-white/5 last:border-0 relative group ${!notif.read ? "bg-primary/[0.02]" : ""}`}
                                        onClick={() => setIsOpen(false)}
                                    >
                                        {!notif.read && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary rounded-r-full"></div>}
                                        <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0 group-hover:border-primary/30 transition-colors">
                                            {getIcon(notif.type)}
                                        </div>
                                        <div className="flex-1 min-w-0 space-y-1">
                                            <div className="flex items-center justify-between">
                                                <span className="text-xs font-black text-white truncate">{notif.title}</span>
                                                <span className="text-[9px] font-bold text-muted-foreground opacity-40 uppercase">{new Date(notif.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                                            </div>
                                            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{notif.message}</p>
                                        </div>
                                    </a>
                                ))
                            )}
                        </div>

                        <a
                            href="/notifications"
                            className="block p-4 text-center text-[10px] font-black text-primary uppercase tracking-[0.2em] bg-white/[0.02] border-t border-white/5 hover:bg-primary hover:text-black transition-all"
                        >
                            Open Command Center
                        </a>
                    </div>
                </>
            )}
        </div>
    );
}

export default function NotificationsPage() {
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [filter, setFilter] = useState<"all" | "unread">("all");
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchNotifs() {
            setLoading(true);
            try {
                const data = await getNotifications();
                setNotifications(data.notifications || []);
            } catch (error) {
                console.error("Failed to load notifications", error);
            } finally {
                setLoading(false);
            }
        }
        fetchNotifs();
    }, []);

    const filtered = filter === "unread"
        ? notifications.filter(n => !n.read)
        : notifications;

    const markAsRead = (id: string) => {
        setNotifications(notifications.map(n =>
            n.id === id ? { ...n, read: true } : n
        ));
    };

    return (
        <div className="max-w-4xl mx-auto space-y-10 pb-20">
            {/* Page Header */}
            <div className="relative p-10 rounded-[2.5rem] bg-white/[0.03] border border-white/5 overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 blur-[100px] rounded-full translate-x-1/2 -translate-y-1/2"></div>
                <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
                    <div>
                        <h1 className="text-4xl font-black text-white tracking-tighter">Command Center</h1>
                        <p className="text-muted-foreground text-sm mt-1">Manage your network notifications and protocol alerts.</p>
                    </div>
                    <div className="flex bg-white/5 p-1.5 rounded-2xl border border-white/5 backdrop-blur-xl">
                        {[
                            { id: 'all', label: 'All Signals' },
                            { id: 'unread', label: 'Unread Only' },
                        ].map((btn) => (
                            <button
                                key={btn.id}
                                onClick={() => setFilter(btn.id as any)}
                                className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${filter === btn.id
                                    ? "bg-primary text-black shadow-[0_10px_20px_rgba(var(--primary-rgb),0.2)]"
                                    : "text-white/40 hover:text-white"}`}
                            >
                                {btn.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <div className="grid gap-4 animate-in fade-in slide-in-from-bottom-5 duration-500">
                {loading ? (
                    <div className="py-20 flex flex-col items-center justify-center space-y-4">
                        <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
                        <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest animate-pulse">Fetching Streams...</p>
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="py-32 text-center space-y-6 rounded-[2rem] bg-white/[0.02] border border-white/5">
                        <div className="w-20 h-20 rounded-full bg-white/5 flex items-center justify-center mx-auto text-white/5">
                            <ShieldCheck size={40} />
                        </div>
                        <div className="space-y-2">
                            <p className="text-xl font-black text-white uppercase tracking-tighter">Negative Signals</p>
                            <p className="text-sm text-muted-foreground max-w-xs mx-auto">Your command center is currently clear. No protocol alerts detected.</p>
                        </div>
                    </div>
                ) : (
                    filtered.map((notif) => (
                        <div
                            key={notif.id}
                            className={`group relative p-6 rounded-[2rem] border transition-all duration-300 flex items-start gap-6 hover:bg-white/[0.04] ${!notif.read
                                ? "bg-white/[0.03] border-primary/20 shadow-[0_10px_30px_-5px_rgba(0,0,0,0.3)]"
                                : "bg-white/[0.01] border-white/5 opacity-80 hover:opacity-100"}`}
                        >
                            {!notif.read && (
                                <div className="absolute top-6 right-6">
                                    <span className="flex h-2 w-2">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                                    </span>
                                </div>
                            )}

                            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 border transition-all ${!notif.read ? "bg-primary/10 border-primary/20 text-primary" : "bg-white/5 border-white/10 text-muted-foreground group-hover:border-white/20"}`}>
                                {notif.type === "order" && <ShoppingBag size={24} />}
                                {notif.type === "follow" && <UserIcon size={24} />}
                                {notif.type === "review" && <Star size={24} className={!notif.read ? "fill-current" : ""} />}
                                {notif.type === "message" && <MessageSquare size={24} />}
                                {notif.type === "badge" && <Award size={24} />}
                            </div>

                            <div className="flex-1 min-w-0 space-y-3">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                    <h3 className="text-lg font-black text-white tracking-tight">{notif.title}</h3>
                                    <div className="flex items-center gap-3 text-[10px] font-bold text-muted-foreground uppercase tracking-widest bg-white/5 px-3 py-1 rounded-full border border-white/5">
                                        <Clock size={10} />
                                        {new Date(notif.created_at).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })}
                                    </div>
                                </div>
                                <p className="text-muted-foreground leading-relaxed italic">{notif.message}</p>
                                <div className="flex flex-wrap items-center gap-4 pt-2">
                                    {notif.link && (
                                        <Link
                                            href={notif.link}
                                            className="px-5 py-2 rounded-xl bg-white/5 border border-white/5 text-[10px] font-black uppercase tracking-widest hover:bg-primary hover:text-black hover:border-primary transition-all"
                                        >
                                            View Target
                                        </Link>
                                    )}
                                    {!notif.read && (
                                        <button
                                            onClick={() => markAsRead(notif.id)}
                                            className="px-5 py-2 rounded-xl bg-primary/10 border border-primary/10 text-[10px] font-black uppercase tracking-widest text-primary hover:bg-primary hover:text-black transition-all"
                                        >
                                            Acknowledge
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
