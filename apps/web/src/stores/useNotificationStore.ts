/**
 * Notification Store
 * Global state for toast notifications
 */

import { create } from 'zustand';

export type NotificationType = 'success' | 'error' | 'warning' | 'info';

export interface Notification {
    id: string;
    type: NotificationType;
    title: string;
    message?: string;
    duration?: number; // ms, 0 = persistent
    action?: {
        label: string;
        onClick: () => void;
    };
    /** Bumped when the same toast is sent again, so its timer restarts. */
    repeat?: number;
}

/** Optional settings for the convenience methods. */
export interface ToastOptions {
    duration?: number;
    action?: Notification['action'];
}

/** Most toasts kept at once; the oldest are dropped past this. */
export const MAX_QUEUED_TOASTS = 6;

interface NotificationState {
    notifications: Notification[];

    // Actions
    addNotification: (notification: Omit<Notification, 'id'>) => string;
    removeNotification: (id: string) => void;
    clearAllNotifications: () => void;

    // Convenience methods
    success: (title: string, message?: string, options?: ToastOptions) => string;
    error: (title: string, message?: string, options?: ToastOptions) => string;
    warning: (title: string, message?: string, options?: ToastOptions) => string;
    info: (title: string, message?: string, options?: ToastOptions) => string;
}

let notificationId = 0;

export const useNotificationStore = create<NotificationState>((set, get) => ({
    notifications: [],

    // Timers live in the toast itself (see Toast.tsx), so they can pause while
    // the pointer is over a toast and wait while it is queued.
    addNotification: (notification) => {
        const same = get().notifications.find(
            (n) =>
                n.type === notification.type &&
                n.title === notification.title &&
                n.message === notification.message,
        );
        if (same) {
            // The same toast again (a double click, a retry): keep one and
            // restart its timer instead of stacking copies.
            set((state) => ({
                notifications: state.notifications.map((n) =>
                    n.id === same.id ? { ...n, repeat: (n.repeat ?? 0) + 1 } : n,
                ),
            }));
            return same.id;
        }
        const id = `notification-${++notificationId}`;
        const next: Notification = {
            ...notification,
            id,
            duration: notification.duration ?? 5000,
        };
        set((state) => ({
            notifications: [...state.notifications, next].slice(-MAX_QUEUED_TOASTS),
        }));
        return id;
    },

    removeNotification: (id) => {
        set((state) => ({
            notifications: state.notifications.filter((n) => n.id !== id),
        }));
    },

    clearAllNotifications: () => {
        set({ notifications: [] });
    },

    // Convenience methods
    success: (title, message, options) => {
        return get().addNotification({ type: 'success', title, message, ...options });
    },

    error: (title, message, options) => {
        return get().addNotification({ type: 'error', title, message, duration: 8000, ...options });
    },

    warning: (title, message, options) => {
        return get().addNotification({ type: 'warning', title, message, ...options });
    },

    info: (title, message, options) => {
        return get().addNotification({ type: 'info', title, message, ...options });
    },
}));

/**
 * Hook for easy toast usage:
 * const toast = useToast();
 * toast.success('Saved!');
 * toast.error('Could not save', 'Try again.', { action: { label: 'Retry', onClick } });
 */
export function useToast() {
    const { success, error, warning, info, removeNotification } = useNotificationStore();
    return { success, error, warning, info, dismiss: removeNotification };
}
