import type { NavigationItem, NavigationSection } from "@/lib/navigation/nav";

/** Routes hidden from default navigation unless the user has the right role. */
const ADMIN_ONLY_ROUTE_KEYS = new Set<string>(["dashboardMonitoring", "dashboardAdmin"]);

export type NavigationFilterOptions = {
    isAdmin: boolean;
    isProvider: boolean;
    isDualRole: boolean;
};

export function filterNavigationItem(item: NavigationItem, options: NavigationFilterOptions): boolean {
    if (ADMIN_ONLY_ROUTE_KEYS.has(item.routeKey) && !options.isAdmin) {
        return false;
    }
    if (item.policy === "provider" && !options.isProvider && !options.isDualRole) {
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
