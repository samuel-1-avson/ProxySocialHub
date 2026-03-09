// Accessibility utilities

// Generate unique IDs for ARIA attributes
let idCounter = 0;
export function generateId(prefix = "a11y"): string {
    idCounter += 1;
    return `${prefix}-${idCounter}`;
}

// Announce messages to screen readers
export function announce(message: string, priority: "polite" | "assertive" = "polite") {
    const announcer = document.createElement("div");
    announcer.setAttribute("role", "status");
    announcer.setAttribute("aria-live", priority);
    announcer.setAttribute("aria-atomic", "true");
    announcer.className = "sr-only";
    announcer.textContent = message;

    document.body.appendChild(announcer);

    // Remove after announcement
    setTimeout(() => {
        document.body.removeChild(announcer);
    }, 1000);
}

// Focus management
export function focusFirstFocusable(element: HTMLElement): boolean {
    const focusable = element.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (focusable) {
        focusable.focus();
        return true;
    }
    return false;
}

export function focusLastFocusable(element: HTMLElement): boolean {
    const focusableElements = element.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (focusableElements.length > 0) {
        focusableElements[focusableElements.length - 1].focus();
        return true;
    }
    return false;
}

// Check if element is focusable
export function isFocusable(element: HTMLElement): boolean {
    const focusableSelectors = [
        'button:not([disabled])',
        '[href]',
        'input:not([disabled])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        '[tabindex]:not([tabindex="-1"])',
    ];
    
    return focusableSelectors.some((selector) => element.matches(selector));
}

// Get all focusable elements
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
    return Array.from(
        container.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
    );
}

// ARIA helper functions
export function getAriaProps(options: {
    label?: string;
    labelledBy?: string;
    describedBy?: string;
    expanded?: boolean;
    selected?: boolean;
    hidden?: boolean;
    pressed?: boolean;
    hasPopup?: boolean | "menu" | "listbox" | "tree" | "grid" | "dialog";
    controls?: string;
    owns?: string;
    current?: boolean | "page" | "step" | "location" | "date" | "time";
}) {
    const props: Record<string, string | boolean> = {};

    if (options.label) props["aria-label"] = options.label;
    if (options.labelledBy) props["aria-labelledby"] = options.labelledBy;
    if (options.describedBy) props["aria-describedby"] = options.describedBy;
    if (options.expanded !== undefined) props["aria-expanded"] = options.expanded;
    if (options.selected !== undefined) props["aria-selected"] = options.selected;
    if (options.hidden !== undefined) props["aria-hidden"] = options.hidden;
    if (options.pressed !== undefined) props["aria-pressed"] = options.pressed;
    if (options.hasPopup !== undefined) props["aria-haspopup"] = options.hasPopup;
    if (options.controls) props["aria-controls"] = options.controls;
    if (options.owns) props["aria-owns"] = options.owns;
    if (options.current !== undefined) props["aria-current"] = options.current;

    return props;
}

// Common ARIA patterns
export const ariaPatterns = {
    // Button pattern
    button: (label: string, pressed?: boolean) => ({
        role: "button",
        tabIndex: 0,
        "aria-label": label,
        ...(pressed !== undefined && { "aria-pressed": pressed }),
    }),

    // Link pattern
    link: (label: string, external = false) => ({
        role: "link",
        tabIndex: 0,
        "aria-label": external ? `${label} (opens in new tab)` : label,
        ...(external && { target: "_blank", rel: "noopener noreferrer" }),
    }),

    // Menu pattern
    menu: (label: string) => ({
        role: "menu",
        "aria-label": label,
    }),

    menuItem: (label: string, disabled = false) => ({
        role: "menuitem",
        tabIndex: disabled ? -1 : 0,
        "aria-disabled": disabled,
    }),

    // Listbox pattern
    listbox: (label: string, multi = false) => ({
        role: "listbox",
        "aria-label": label,
        "aria-multiselectable": multi,
    }),

    listboxOption: (label: string, selected = false, disabled = false) => ({
        role: "option",
        "aria-label": label,
        "aria-selected": selected,
        "aria-disabled": disabled,
    }),

    // Tab pattern
    tabList: (label: string) => ({
        role: "tablist",
        "aria-label": label,
    }),

    tab: (label: string, selected = false, controls: string) => ({
        role: "tab",
        tabIndex: selected ? 0 : -1,
        "aria-selected": selected,
        "aria-controls": controls,
        "aria-label": label,
    }),

    tabPanel: (labelledBy: string, hidden = false) => ({
        role: "tabpanel",
        "aria-labelledby": labelledBy,
        hidden,
    }),

    // Dialog pattern
    dialog: (label: string, describedBy?: string) => ({
        role: "dialog",
        "aria-modal": true,
        "aria-label": label,
        ...(describedBy && { "aria-describedby": describedBy }),
    }),

    // Alert pattern
    alert: (label: string) => ({
        role: "alert",
        "aria-label": label,
    }),

    // Status pattern
    status: (label: string) => ({
        role: "status",
        "aria-live": "polite",
        "aria-atomic": true,
        "aria-label": label,
    }),

    // Progress pattern
    progress: (label: string, value: number, max = 100) => ({
        role: "progressbar",
        "aria-label": label,
        "aria-valuenow": value,
        "aria-valuemin": 0,
        "aria-valuemax": max,
    }),

    // Search pattern
    search: (label: string) => ({
        role: "search",
        "aria-label": label,
    }),

    // Feed pattern (for infinite scroll lists)
    feed: (label: string) => ({
        role: "feed",
        "aria-label": label,
    }),

    article: (label: string, posInSet?: number, setSize?: number) => ({
        role: "article",
        "aria-label": label,
        ...(posInSet !== undefined && { "aria-posinset": posInSet }),
        ...(setSize !== undefined && { "aria-setsize": setSize }),
    }),
};

// Keyboard key codes
export const Keys = {
    Enter: "Enter",
    Escape: "Escape",
    Space: " ",
    Tab: "Tab",
    ArrowUp: "ArrowUp",
    ArrowDown: "ArrowDown",
    ArrowLeft: "ArrowLeft",
    ArrowRight: "ArrowRight",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
} as const;

// Skip link component
export function createSkipLink(targetId: string, label = "Skip to main content"): HTMLElement {
    const link = document.createElement("a");
    link.href = `#${targetId}`;
    link.textContent = label;
    link.className = "sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded";
    return link;
}

// High contrast mode detection
export function prefersHighContrast(): boolean {
    return window.matchMedia("(prefers-contrast: more)").matches;
}

// Reduced motion detection
export function prefersReducedMotion(): boolean {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Focus visible detection (for :focus-visible polyfill)
export function isFocusVisible(): boolean {
    return window.matchMedia("(prefers-focus: visible)").matches;
}
