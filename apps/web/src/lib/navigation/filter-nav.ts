import type { NavigationItem, NavigationSection } from "@/lib/navigation/nav";
import { isUnifiedNetworkEnabled } from "@/lib/feature-flags";

/** Routes hidden from default navigation unless the user has the right role. */
const ADMIN_ONLY_ROUTE_KEYS = new Set<string>(["dashboardMonitoring", "dashboardAdmin"]);

/** Shown only when the corresponding NEXT_PUBLIC_* flag is enabled. */
const UNIFIED_NETWORK_ROUTE_KEYS = new Set<string>(["network"]);

export type NavigationFilterOptions = {
    isAdmin: boolean;
    isProvider: boolean;
    isDualRole: boolean;
    /** When false, items with policy "authenticated" are hidden. */
    isAuthenticated?: boolean;
};

export function filterNavigationItem(item: NavigationItem, options: NavigationFilterOptions): boolean {
    if (UNIFIED_NETWORK_ROUTE_KEYS.has(item.routeKey) && !isUnifiedNetworkEnabled()) {
        return false;
    }
    if (ADMIN_ONLY_ROUTE_KEYS.has(item.routeKey) && !options.isAdmin) {
        return false;
    }
    // Hide apply CTA once the user is already a provider.
    if (
        item.routeKey === "dashboardBecomeProvider" &&
        (options.isProvider || options.isDualRole)
    ) {
        return false;
    }
    if (item.policy === "provider" && !options.isProvider && !options.isDualRole) {
        return false;
    }
    if (item.policy === "authenticated" && options.isAuthenticated === false) {
        return false;
    }
    return true;
}

export function filterNavigationSection(
    section: NavigationSection,
    options: NavigationFilterOptions,
): NavigationSection {
    return {
        ...section,
        items: section.items.filter((item) => filterNavigationItem(item, options)),
    };
}

export function filterNavigationSections(
    sections: NavigationSection[],
    options: NavigationFilterOptions,
): NavigationSection[] {
    return sections
        .map((section) => filterNavigationSection(section, options))
        .filter((section) => section.items.length > 0);
}

