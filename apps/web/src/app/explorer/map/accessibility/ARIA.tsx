"use client";

/**
 * Accessibility Components
 * ARIA labels, keyboard navigation, focus management
 */

import React, { useEffect, useRef, useState, createContext, useContext } from "react";
import { motion, AnimatePresence } from "framer-motion";

// Announcement context for screen readers
interface AnnouncementContextType {
  announce: (message: string, priority?: "polite" | "assertive") => void;
}

const AnnouncementContext = createContext<AnnouncementContextType | null>(null);

export function useAnnouncement() {
  const context = useContext(AnnouncementContext);
  if (!context) {
    throw new Error("useAnnouncement must be used within LiveRegionProvider");
  }
  return context;
}

// Live region provider for screen reader announcements
export function LiveRegionProvider({ children }: { children: React.ReactNode }) {
  const [announcement, setAnnouncement] = useState("");
  const [priority, setPriority] = useState<"polite" | "assertive">("polite");

  const announce = (message: string, prio: "polite" | "assertive" = "polite") => {
    setAnnouncement(message);
    setPriority(prio);
    // Clear after announcement
    setTimeout(() => setAnnouncement(""), 1000);
  };

  return (
    <AnnouncementContext.Provider value={{ announce }}>
      {children}
      {/* Live region for screen readers */}
      <div
        aria-live={priority}
        aria-atomic="true"
        className="sr-only"
        role="status"
      >
        {announcement}
      </div>
    </AnnouncementContext.Provider>
  );
}

// Skip link for keyboard navigation
export function SkipLink({ targetId }: { targetId: string }) {
  return (
    <a
      href={`#${targetId}`}
      className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:bg-cyan-500 focus:text-black focus:font-medium focus:rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500"
    >
      Skip to main content
    </a>
  );
}

// Visually hidden element for screen readers
export function VisuallyHidden({ children }: { children: React.ReactNode }) {
  return (
    <span className="sr-only">
      {children}
    </span>
  );
}

// Focus trap for modals and panels
interface FocusTrapProps {
  children: React.ReactNode;
  isActive: boolean;
  onEscape?: () => void;
}

export function FocusTrap({ children, isActive, onEscape }: FocusTrapProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isActive) return;

    const container = containerRef.current;
    if (!container) return;

    // Find all focusable elements
    const focusableElements = container.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    // Focus first element
    firstElement?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onEscape) {
        onEscape();
        return;
      }

      if (e.key !== "Tab") return;

      // Trap focus
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
  }, [isActive, onEscape]);

  if (!isActive) return <>{children}</>;

  return <div ref={containerRef}>{children}</div>;
}

// Accessible button with keyboard support
interface AccessibleButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  description?: string;
  shortcut?: string;
}

export function AccessibleButton({
  label,
  description,
  shortcut,
  children,
  ...props
}: AccessibleButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-describedby={description ? `${props.id}-desc` : undefined}
      data-shortcut={shortcut}
      {...props}
    >
      {children}
      {description && (
        <span id={`${props.id}-desc`} className="sr-only">
          {description}
        </span>
      )}
    </button>
  );
}

// Keyboard shortcut helper
export function useKeyboardShortcut(
  key: string,
  callback: () => void,
  modifiers?: { ctrl?: boolean; alt?: boolean; shift?: boolean }
) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const keyMatch = e.key.toLowerCase() === key.toLowerCase();
      const ctrlMatch = modifiers?.ctrl ? e.ctrlKey || e.metaKey : true;
      const altMatch = modifiers?.alt ? e.altKey : true;
      const shiftMatch = modifiers?.shift ? e.shiftKey : true;

      if (keyMatch && ctrlMatch && altMatch && shiftMatch) {
        e.preventDefault();
        callback();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [key, callback, modifiers]);
}

// Focus visible indicator
export function FocusRing({ children }: { children: React.ReactNode }) {
  return (
    <div className="focus-within:ring-2 focus-within:ring-cyan-500 focus-within:ring-offset-2 focus-within:ring-offset-black rounded-lg transition-all">
      {children}
    </div>
  );
}

// Reduced motion preference
export function useReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mediaQuery.matches);

    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, []);

  return prefersReducedMotion;
}

// Accessible tooltip
interface AccessibleTooltipProps {
  trigger: React.ReactNode;
  content: string;
  position?: "top" | "bottom" | "left" | "right";
}

export function AccessibleTooltip({
  trigger,
  content,
  position = "top",
}: AccessibleTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);

  const positionClasses = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
  };

  return (
    <div
      ref={triggerRef}
      className="relative inline-block"
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
      onFocus={() => setIsVisible(true)}
      onBlur={() => setIsVisible(false)}
    >
      {trigger}
      <AnimatePresence>
        {isVisible && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            role="tooltip"
            className={`absolute ${positionClasses[position]} z-50 px-3 py-1.5 bg-black/90 border border-white/10 rounded-lg text-white text-sm whitespace-nowrap pointer-events-none`}
          >
            {content}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// High contrast mode support
export function HighContrastStyles() {
  return (
    <style jsx global>{`
      @media (prefers-contrast: high) {
        .glass-panel {
          border-width: 2px !important;
          border-color: white !important;
        }
        
        .node-marker {
          filter: drop-shadow(0 0 4px white) !important;
        }
        
        button:focus,
        a:focus {
          outline: 3px solid white !important;
          outline-offset: 2px !important;
        }
      }
    `}</style>
  );
}

export default {
  LiveRegionProvider,
  useAnnouncement,
  SkipLink,
  VisuallyHidden,
  FocusTrap,
  AccessibleButton,
  useKeyboardShortcut,
  FocusRing,
  useReducedMotion,
  AccessibleTooltip,
  HighContrastStyles,
};
