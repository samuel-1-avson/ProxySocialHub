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
}

interface NotificationState {
    notifications: Notification[];

    // Actions
    addNotification: (notification: Omit<Notification, 'id'>) => string;
    removeNotification: (id: string) => void;
    clearAllNotifications: () => void;

    // Convenience methods
    success: (title: string, message?: string) => string;
    error: (title: string, message?: string) => string;
    warning: (title: string, message?: string) => string;
    info: (title: string, message?: string) => string;
}

let notificationId = 0;

export const useNotificationStore = create<NotificationState>((set, get) => ({
    notifications: [],

    addNotification: (notification) => {
        const id = `notification-${++notificationId}`;
        const newNotification: Notification = {
            ...notification,
            id,
            duration: notification.duration ?? 5000,
        };

        set((state) => ({
            notifications: [...state.notifications, newNotification],
        }));

        // Auto-remove after duration (if not persistent)
        if (newNotification.duration && newNotification.duration > 0) {
            setTimeout(() => {
                get().removeNotification(id);
            }, newNotification.duration);
        }

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
    success: (title, message) => {
        return get().addNotification({ type: 'success', title, message });
    },

    error: (title, message) => {
        return get().addNotification({ type: 'error', title, message, duration: 8000 });
    },

    warning: (title, message) => {
        return get().addNotification({ type: 'warning', title, message });
    },

    info: (title, message) => {
        return get().addNotification({ type: 'info', title, message });
    },
}));

/**
 * Hook for easy toast usage:
 * const toast = useToast();
 * toast.success('Saved!');
 */
export function useToast() {
    const { success, error, warning, info, removeNotification } = useNotificationStore();
    return { success, error, warning, info, dismiss: removeNotification };
}
