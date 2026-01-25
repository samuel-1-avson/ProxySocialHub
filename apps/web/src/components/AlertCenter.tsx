'use client';

import { useState, useEffect } from 'react';
import { getWatchtowerAlerts, AlertEvent } from '@/lib/api/monitoring';
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
        try {
            const data = await getWatchtowerAlerts();
            setAlerts(data || []);
            // Simple logic: if count increases, show red dot
            if ((data || []).length > alerts.length) {
                setUnreadCount(prev => prev + (data.length - alerts.length));
            }
        } catch (err) {
            console.error("Failed to fetch alerts", err);
        }
    };

    useEffect(() => {
        fetchAlerts();
        const interval = setInterval(fetchAlerts, 30000); // 30s Industrial Polling
        return () => clearInterval(interval);
    }, [alerts.length]);

    const getSeverityStyles = (severity: string) => {
        switch (severity) {
            case 'CRITICAL':
                return 'bg-red-500/10 border-red-500/20 text-red-500';
            case 'WARNING':
                return 'bg-yellow-500/10 border-yellow-500/20 text-yellow-500';
            default:
                return 'bg-blue-500/10 border-blue-500/20 text-blue-500';
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
                className={`relative p-2 rounded-full transition-all duration-300 ${isOpen ? 'bg-primary/20 text-primary' : 'bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-white'
                    }`}
            >
                <Bell size={20} />
                {unreadCount > 0 && (
                    <span className="absolute top-0 right-0 w-4 h-4 bg-red-500 text-[8px] font-black text-white rounded-full flex items-center justify-center animate-pulse">
                        {unreadCount}
                    </span>
                )}
            </button>

            {/* Popover */}
            <AnimatePresence>
                {isOpen && (
                    <>
                        <div
                            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]"
                            onClick={() => setIsOpen(false)}
                        />
                        <motion.div
                            initial={{ opacity: 0, y: 10, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.95 }}
                            className="absolute right-0 mt-4 w-80 z-50 bg-[#0a0a0a] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
                        >
                            <div className="p-4 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                                <div className="flex items-center gap-2">
                                    <Activity size={16} className="text-primary" />
                                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-white">Watchtower Sentry</h3>
                                </div>
                                <button onClick={() => setIsOpen(false)} className="text-white/20 hover:text-white transition-colors">
                                    <X size={16} />
                                </button>
                            </div>

                            <div className="max-h-[400px] overflow-y-auto custom-scrollbar p-2 space-y-2">
                                {alerts.length === 0 ? (
                                    <div className="py-10 text-center text-[10px] font-mono text-white/20 uppercase">
                                        No active triggers detected
                                    </div>
                                ) : (
                                    alerts.map((alert, idx) => (
                                        <div
                                            key={idx}
                                            className={`p-3 rounded-xl border transition-all ${getSeverityStyles(alert.severity)}`}
                                        >
                                            <div className="flex items-start gap-3">
                                                <div className="mt-0.5">
                                                    {getSeverityIcon(alert.severity)}
                                                </div>
                                                <div className="flex-1 space-y-1">
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-[10px] font-black uppercase tracking-widest">{alert.severity}</span>
                                                        <span className="text-[8px] opacity-40 font-mono flex items-center gap-1">
                                                            <Clock size={8} />
                                                            {new Date(alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                        </span>
                                                    </div>
                                                    <p className="text-xs font-bold text-white/90 leading-tight">{alert.message}</p>
                                                    <p className="text-[9px] font-mono opacity-60 break-all">{alert.resource}</p>
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>

                            <div className="p-3 border-t border-white/5 text-center">
                                <button className="text-[8px] font-black uppercase tracking-widest text-white/30 hover:text-white transition-colors">
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
