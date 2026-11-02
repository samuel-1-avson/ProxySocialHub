'use client';

/**
 * Toast notifications.
 * Cards in the site's own surface style, a coloured edge and icon per kind, a
 * line showing the time left, paused while hovered or focused. At most three
 * show at once; the rest wait their turn.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Check, AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { useNotificationStore, type Notification } from '@/stores';

const icons = {
    success: Check,
    error: AlertCircle,
    warning: AlertTriangle,
    info: Info,
};

/** How many toasts show together; newer ones push older ones into the queue. */
export const MAX_VISIBLE_TOASTS = 3;
const EXIT_MS = 180;

function ToastItem({ notification }: { notification: Notification }) {
    const removeNotification = useNotificationStore((state) => state.removeNotification);
    const Icon = icons[notification.type];
    const [exiting, setExiting] = useState(false);
    const [paused, setPaused] = useState(false);
    const duration = notification.duration ?? 5000;
    const timed = duration > 0;
    // Time left survives a pause, so hovering does not restart the clock.
    const remaining = useRef(duration);
    const startedAt = useRef(0);

    const dismiss = useCallback(() => {
        setExiting(true);
        window.setTimeout(() => removeNotification(notification.id), EXIT_MS);
    }, [notification.id, removeNotification]);

    // Sent again: start the timer over.
    useEffect(() => {
        remaining.current = duration;
    }, [notification.repeat, duration]);

    useEffect(() => {
        if (!timed || paused || exiting) return;
        startedAt.current = Date.now();
        const timer = window.setTimeout(dismiss, remaining.current);
        return () => {
            window.clearTimeout(timer);
            remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current));
        };
    }, [timed, paused, exiting, dismiss, notification.repeat]);

    const urgent = notification.type === 'error';
    return (
        <div
            className="toast"
            data-type={notification.type}
            data-exiting={exiting || undefined}
            data-paused={paused || undefined}
            role={urgent ? 'alert' : 'status'}
            aria-live={urgent ? 'assertive' : 'polite'}
            aria-atomic="true"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onFocus={() => setPaused(true)}
            onBlur={() => setPaused(false)}
            style={{ ['--toast-duration' as string]: `${duration}ms` }}
        >
            <span className="toast-icon" aria-hidden="true">
                <Icon size={16} />
            </span>
            <div className="toast-body">
                <p className="toast-title">{notification.title}</p>
                {notification.message && <p className="toast-message">{notification.message}</p>}
                {notification.action && (
                    <button
                        type="button"
                        className="toast-action"
                        onClick={() => {
                            notification.action?.onClick();
                            dismiss();
                        }}
                    >
                        {notification.action.label}
                    </button>
                )}
            </div>
            <button
                type="button"
                className="toast-close"
                aria-label={`Dismiss: ${notification.title}`}
                onClick={dismiss}
            >
                <X size={14} aria-hidden="true" />
            </button>
            {timed && (
                <span
                    // The key restarts the bar when the same toast is sent again.
                    key={notification.repeat ?? 0}
                    className="toast-timer"
                    aria-hidden="true"
                />
            )}
        </div>
    );
}

export function ToastContainer() {
    const notifications = useNotificationStore((state) => state.notifications);
    // Browser tests drive toasts through this; it exists only in the e2e dev build.
    useEffect(() => {
        if (
            process.env.NODE_ENV !== 'production' &&
            process.env.NEXT_PUBLIC_PLAYWRIGHT_E2E_MOCK_BUY === '1'
        ) {
            (window as unknown as { __proxyhubbToast?: unknown }).__proxyhubbToast =
                useNotificationStore.getState();
        }
    }, []);
    if (notifications.length === 0) return null;
    // Newest toasts show; older ones wait and start their timers when shown.
    const visible = notifications.slice(-MAX_VISIBLE_TOASTS);
    const waiting = notifications.length - visible.length;
    return (
        <div className="toast-region" role="region" aria-label="Notifications">
            {visible.map((notification) => (
                <ToastItem key={notification.id} notification={notification} />
            ))}
            {waiting > 0 && (
                <p className="toast-waiting" role="status">
                    {waiting} more waiting
                </p>
            )}
        </div>
    );
}

export default ToastContainer;
