"use client";

import { useCallback, useEffect, useRef } from "react";

interface UseKeyboardNavigationOptions {
    onEscape?: () => void;
    onEnter?: () => void;
    onArrowUp?: () => void;
    onArrowDown?: () => void;
    onArrowLeft?: () => void;
    onArrowRight?: () => void;
    onTab?: (e: React.KeyboardEvent) => void;
    onHome?: () => void;
    onEnd?: () => void;
    trapFocus?: boolean;
}

export function useKeyboardNavigation(options: UseKeyboardNavigationOptions) {
    const containerRef = useRef<HTMLElement>(null);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            switch (e.key) {
                case "Escape":
                    if (options.onEscape) {
                        e.preventDefault();
                        options.onEscape();
                    }
                    break;
                case "Enter":
                    if (options.onEnter && !e.repeat) {
                        e.preventDefault();
                        options.onEnter();
                    }
                    break;
                case "ArrowUp":
                    if (options.onArrowUp) {
                        e.preventDefault();
                        options.onArrowUp();
                    }
                    break;
                case "ArrowDown":
                    if (options.onArrowDown) {
                        e.preventDefault();
                        options.onArrowDown();
                    }
                    break;
                case "ArrowLeft":
                    if (options.onArrowLeft) {
                        e.preventDefault();
                        options.onArrowLeft();
                    }
                    break;
                case "ArrowRight":
                    if (options.onArrowRight) {
                        e.preventDefault();
                        options.onArrowRight();
                    }
                    break;
                case "Tab":
                    if (options.onTab) {
                        options.onTab(e);
                    }
                    if (options.trapFocus) {
                        handleTabTrap(e);
                    }
                    break;
                case "Home":
                    if (options.onHome) {
                        e.preventDefault();
                        options.onHome();
                    }
                    break;
                case "End":
                    if (options.onEnd) {
                        e.preventDefault();
                        options.onEnd();
                    }
                    break;
            }
        },
        [options]
    );

    const handleTabTrap = (e: React.KeyboardEvent) => {
        if (!containerRef.current) return;

        const focusableElements = containerRef.current.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const firstElement = focusableElements[0] as HTMLElement;
        const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

        if (e.shiftKey && document.activeElement === firstElement) {
            e.preventDefault();
            lastElement?.focus();
        } else if (!e.shiftKey && document.activeElement === lastElement) {
            e.preventDefault();
            firstElement?.focus();
        }
    };

    return {
        containerRef,
        handleKeyDown,
    };
}

// Hook for managing focus within a list
export function useListNavigation(itemCount: number, onSelect: (index: number) => void) {
    const [focusedIndex, setFocusedIndex] = useState(-1);
    const itemRefs = useRef<(HTMLElement | null)[]>([]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            switch (e.key) {
                case "ArrowDown":
                    e.preventDefault();
                    setFocusedIndex((prev) => {
                        const next = Math.min(prev + 1, itemCount - 1);
                        itemRefs.current[next]?.focus();
                        return next;
                    });
                    break;
                case "ArrowUp":
                    e.preventDefault();
                    setFocusedIndex((prev) => {
                        const next = Math.max(prev - 1, 0);
                        itemRefs.current[next]?.focus();
                        return next;
                    });
                    break;
                case "Enter":
                    if (focusedIndex >= 0) {
                        e.preventDefault();
                        onSelect(focusedIndex);
                    }
                    break;
                case "Home":
                    e.preventDefault();
                    setFocusedIndex(0);
                    itemRefs.current[0]?.focus();
                    break;
                case "End":
                    e.preventDefault();
                    setFocusedIndex(itemCount - 1);
                    itemRefs.current[itemCount - 1]?.focus();
                    break;
            }
        },
        [itemCount, focusedIndex, onSelect]
    );

    const setItemRef = useCallback((index: number) => (el: HTMLElement | null) => {
        itemRefs.current[index] = el;
    }, []);

    return {
        focusedIndex,
        setFocusedIndex,
        handleKeyDown,
        setItemRef,
    };
}

// Hook for managing focus trap in modals/dropdowns
export function useFocusTrap(isActive: boolean) {
    const containerRef = useRef<HTMLElement>(null);
    const previousFocus = useRef<HTMLElement | null>(null);

    useEffect(() => {
        if (isActive) {
            previousFocus.current = document.activeElement as HTMLElement;
            
            // Focus first focusable element
            const focusableElements = containerRef.current?.querySelectorAll(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            );
            (focusableElements?.[0] as HTMLElement)?.focus();
        } else {
            previousFocus.current?.focus();
        }
    }, [isActive]);

    useEffect(() => {
        if (!isActive) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key !== "Tab") return;

            const focusableElements = containerRef.current?.querySelectorAll(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            );
            
            if (!focusableElements || focusableElements.length === 0) return;

            const firstElement = focusableElements[0] as HTMLElement;
            const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

            if (e.shiftKey && document.activeElement === firstElement) {
                e.preventDefault();
                lastElement?.focus();
            } else if (!e.shiftKey && document.activeElement === lastElement) {
                e.preventDefault();
                firstElement?.focus();
            }
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [isActive]);

    return containerRef;
}

import { useState } from "react";
