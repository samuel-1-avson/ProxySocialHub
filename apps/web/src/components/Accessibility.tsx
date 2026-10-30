/**
 * Accessibility Components
 * Skip links, focus management, and screen reader utilities
 */

'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Skip Link - allows keyboard users to skip to main content
 * Should be placed at the very beginning of the page
 */
export function SkipLink({ href = '#main-content', children = 'Skip to main content' }: {
    href?: string;
    children?: React.ReactNode;
}) {
    return (
        <a
            href={href}
            className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[200] focus:bg-primary focus:text-primary-foreground focus:px-4 focus:py-2 focus:rounded-sm focus:font-mono focus:text-sm focus:font-bold focus:shadow-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
            {children}
        </a>
    );
}

/**
 * Visually Hidden - content visible to screen readers only
 */
export function VisuallyHidden({ children }: { children: React.ReactNode }) {
    return (
        <span className="sr-only">
            {children}
        </span>
    );
}

/**
 * Announce - announces content to screen readers
 * Uses aria-live regions for dynamic updates
 */
export function Announce({
    message,
    politeness = 'polite'
}: {
    message: string;
    politeness?: 'polite' | 'assertive';
}) {
    return (
        <div
            role="status"
            aria-live={politeness}
            aria-atomic="true"
            className="sr-only"
        >
            {message}
        </div>
    );
}

/**
 * Focus Trap - traps focus within a container (for modals, dialogs)
 */
export function FocusTrap({
    children,
    active = true,
    onEscape,
}: {
    children: React.ReactNode;
    active?: boolean;
    onEscape?: () => void;
}) {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!active) return;

        const container = containerRef.current;
        if (!container) return;

        const focusableElements = container.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const firstFocusable = focusableElements[0] as HTMLElement;
        const lastFocusable = focusableElements[focusableElements.length - 1] as HTMLElement;

        // Focus first element on mount
        firstFocusable?.focus();

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && onEscape) {
                onEscape();
                return;
            }

            if (e.key !== 'Tab') return;

            if (e.shiftKey) {
                if (document.activeElement === firstFocusable) {
                    e.preventDefault();
                    lastFocusable?.focus();
                }
            } else {
                if (document.activeElement === lastFocusable) {
                    e.preventDefault();
                    firstFocusable?.focus();
                }
            }
        };

        container.addEventListener('keydown', handleKeyDown);
        return () => container.removeEventListener('keydown', handleKeyDown);
    }, [active, onEscape]);

    return <div ref={containerRef}>{children}</div>;
}

/**
 * Focus on mount - automatically focuses an element when mounted
 */
export function useFocusOnMount<T extends HTMLElement>() {
    const ref = useRef<T>(null);

    useEffect(() => {
        ref.current?.focus();
    }, []);

    return ref;
}

/**
 * Keyboard navigation hook - for custom keyboard interactions
 */
export function useKeyboardNavigation(keys: Record<string, () => void>) {
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const handler = keys[e.key];
            if (handler) {
                e.preventDefault();
                handler();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [keys]);
}

/**
 * Reduced motion hook - respects user's motion preferences
 */
export function usePrefersReducedMotion() {
    const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

    useEffect(() => {
        const query = window.matchMedia('(prefers-reduced-motion: reduce)');
        setPrefersReducedMotion(query.matches);

        const handleChange = (e: MediaQueryListEvent) => {
            setPrefersReducedMotion(e.matches);
        };

        query.addEventListener('change', handleChange);
        return () => query.removeEventListener('change', handleChange);
    }, []);

    return prefersReducedMotion;
}

/**
 * High contrast hook - detects high contrast mode
 */
export function usePrefersHighContrast() {
    const [prefersHighContrast, setPrefersHighContrast] = useState(false);

    useEffect(() => {
        const query = window.matchMedia('(prefers-contrast: more)');
        setPrefersHighContrast(query.matches);

        const handleChange = (e: MediaQueryListEvent) => {
            setPrefersHighContrast(e.matches);
        };

        query.addEventListener('change', handleChange);
        return () => query.removeEventListener('change', handleChange);
    }, []);

    return prefersHighContrast;
}

export default SkipLink;
