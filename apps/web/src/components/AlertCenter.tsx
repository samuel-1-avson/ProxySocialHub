'use client';

import { useState, useEffect } from 'react';
import { getWatchtowerAlerts, AlertEvent } from '@/lib/api/monitoring';
import { isAuthenticated } from '@/lib/auth';
import {
    Bell,
    X,
    AlertTriangle,
    ShieldAlert,
    Info,
    Clock,
    Activity
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export function AlertCenter() {
    const [isOpen, setIsOpen] = useState(false);
    const [alerts, setAlerts] = useState<AlertEvent[]>([]);
    const [loading, setLoading] = useState(false);
    const [unreadCount, setUnreadCount] = useState(0);

    const fetchAlerts = async () => {
        // Skip if not authenticated
        if (!isAuthenticated()) {
            return;
        }
        try {
            const data = await getWatchtowerAlerts();
            setAlerts(data || []);
            // Simple logic: if count increases, show red dot
            if ((data || []).length > alerts.length) {
                setUnreadCount(prev => prev + (data.length - alerts.length));
            }
        } catch (err) {
            // Silently ignore auth errors
            if (err instanceof Error && err.message === 'Not authenticated') {
                return;
            }
            console.error("Failed to fetch alerts", err);
        }
    };

    useEffect(() => {
        // Only fetch if authenticated
        if (!isAuthenticated()) {
            return;
        }
        fetchAlerts();
        const interval = setInterval(fetchAlerts, 30000); // 30s Industrial Polling
        return () => clearInterval(interval);
    }, [alerts.length]);

    const getSeverityStyles = (severity: string) => {
        switch (severity) {
            case 'CRITICAL':
                return 'bg-destructive/10 border-destructive/20 text-destructive';
            case 'WARNING':
                return 'bg-warning/10 border-warning/20 text-warning';
            default:
                return 'bg-info/10 border-info/20 text-info';
        }
    };

    const getSeverityIcon = (severity: string) => {
        switch (severity) {
            case 'CRITICAL':
                return <ShieldAlert size={14} />;
            case 'WARNING':
                return <AlertTriangle size={14} />;
            default:
                return <Info size={14} />;
        }
    };

    return (
        <div className="relative">
            {/* Trigger */}
            <button
                onClick={() => {
                    setIsOpen(!isOpen);
                    setUnreadCount(0);
                }}
                className={`relative p-2 rounded-full transition-all duration-300 ${isOpen ? 'bg-primary/20 text-primary' : 'bg-secondary text-muted-foreground hover:bg-secondary hover:text-foreground'
                    }`}
            >
                <Bell size={20} />
                {unreadCount > 0 && (
                    <span className="absolute top-0 right-0 w-4 h-4 bg-destructive text-xs font-semibold text-destructive-foreground rounded-full flex items-center justify-center animate-pulse">
                        {unreadCount}
                    </span>
                )}
            </button>

            {/* Popover */}
            <AnimatePresence>
                {isOpen && (
                    <>
                        <div
                            className="fixed inset-0 z-40 bg-secondary backdrop-blur-[2px]"
                            onClick={() => setIsOpen(false)}
                        />
                        <motion.div
                            initial={{ opacity: 0, y: 10, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.95 }}
                            className="absolute right-0 mt-4 w-80 z-50 bg-[#0a0a0a] border border-border rounded-lg shadow-sm overflow-hidden"
                        >
                            <div className="p-4 border-b border-border flex items-center justify-between bg-secondary">
                                <div className="flex items-center gap-2">
                                    <Activity size={16} className="text-primary" />
                                    <h3 className="text-xs font-semibold text-foreground">Watchtower Sentry</h3>
                                </div>
                                <button onClick={() => setIsOpen(false)} className="text-muted-foreground hover:text-foreground transition-colors">
                                    <X size={16} />
                                </button>
                            </div>

                            <div className="max-h-[400px] overflow-y-auto custom-scrollbar p-2 space-y-2">
                                {alerts.length === 0 ? (
                                    <div className="py-10 text-center text-xs font-mono text-muted-foreground">
                                        No active triggers detected
                                    </div>
                                ) : (
                                    alerts.map((alert, idx) => (
                                        <div
                                            key={idx}
                                            className={`p-3 rounded-lg border transition-all ${getSeverityStyles(alert.severity)}`}
                                        >
                                            <div className="flex items-start gap-3">
                                                <div className="mt-0.5">
                                                    {getSeverityIcon(alert.severity)}
                                                </div>
                                                <div className="flex-1 space-y-1">
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-xs font-semibold">{alert.severity}</span>
                                                        <span className="text-xs opacity-40 font-mono flex items-center gap-1">
                                                            <Clock size={8} />
                                                            {new Date(alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                        </span>
                                                    </div>
                                                    <p className="text-xs font-bold text-foreground leading-tight">{alert.message}</p>
                                                    <p className="text-xs font-mono opacity-60 break-all">{alert.resource}</p>
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>

                            <div className="p-3 border-t border-border text-center">
                                <button className="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors">
                                    View Security Audit Log
                                </button>
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
}
