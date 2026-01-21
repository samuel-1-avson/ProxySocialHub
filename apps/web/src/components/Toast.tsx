'use client';

/**
 * Toast Notification Component
 * Displays notifications from the notification store
 */

import { useNotificationStore, type Notification } from '@/stores';
import { X, Check, AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { useEffect, useState } from 'react';

const icons = {
    success: Check,
    error: AlertCircle,
    warning: AlertTriangle,
    info: Info,
};

const styles = {
    success: 'bg-green-500/10 border-green-500/30 text-green-500',
    error: 'bg-destructive/10 border-destructive/30 text-destructive',
    warning: 'bg-amber-500/10 border-amber-500/30 text-amber-500',
    info: 'bg-blue-500/10 border-blue-500/30 text-blue-500',
};

function ToastItem({ notification }: { notification: Notification }) {
    const [isExiting, setIsExiting] = useState(false);
    const { removeNotification } = useNotificationStore();
    const Icon = icons[notification.type];

    const handleDismiss = () => {
        setIsExiting(true);
        setTimeout(() => {
            removeNotification(notification.id);
        }, 150);
    };

    return (
        <div
            className={`
                flex items-start gap-3 p-4 rounded-sm border shadow-lg backdrop-blur-sm
                transform transition-all duration-150 ease-out
                ${styles[notification.type]}
                ${isExiting ? 'opacity-0 translate-x-4' : 'opacity-100 translate-x-0'}
            `}
        >
            <div className="flex-shrink-0 mt-0.5">
                <Icon size={18} />
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-sm font-bold font-mono">{notification.title}</p>
                {notification.message && (
                    <p className="text-xs mt-1 opacity-80">{notification.message}</p>
                )}
                {notification.action && (
                    <button
                        onClick={notification.action.onClick}
                        className="text-xs font-bold mt-2 underline hover:no-underline"
                    >
                        {notification.action.label}
                    </button>
                )}
            </div>
            <button
                onClick={handleDismiss}
                className="flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity"
            >
                <X size={16} />
            </button>
        </div>
    );
}

export function ToastContainer() {
    const { notifications } = useNotificationStore();

    if (notifications.length === 0) return null;

    return (
        <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-auto">
            {notifications.map((notification) => (
                <ToastItem key={notification.id} notification={notification} />
            ))}
        </div>
    );
}

export default ToastContainer;
