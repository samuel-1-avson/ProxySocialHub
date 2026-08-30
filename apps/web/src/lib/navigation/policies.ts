import { getStaticRouteEntries, ROUTES } from "@/lib/navigation/routes";

export type RouteKey = keyof typeof ROUTES;
export type RoutePolicy = "public" | "authenticated" | "provider" | "admin";

export const ROUTE_POLICIES: Record<RouteKey, RoutePolicy> = {
    home: "public",
    marketplace: "public",
    network: "public",
    marketplaceMap: "public",
    marketplaceCatalog: "provider",
    marketplaceCreate: "provider",
    marketplaceManage: "provider",
    marketplaceOrders: "authenticated",
    marketplaceOrder: "authenticated",
    marketplaceSaved: "authenticated",
    marketplaceAgents: "authenticated",
    marketplaceAgentInstances: "authenticated",
    dashboard: "authenticated",
    dashboardAdmin: "admin",
    dashboardAgents: "authenticated",
    dashboardAnalytics: "authenticated",
    dashboardFeed: "authenticated",
    dashboardMessages: "authenticated",
    dashboardMonitoring: "authenticated",
    dashboardProfile: "authenticated",
    dashboardProxy: "authenticated",
    dashboardOrder: "authenticated",
    dashboardSecurity: "authenticated",
    dashboardSessions: "authenticated",
    dashboardUsage: "authenticated",
    dashboardSubscriptions: "authenticated",
    dashboardTrustless: "authenticated",
    dashboardWallet: "authenticated",
    /** Buyer onboarding — apply before provider role is granted. */
    dashboardBecomeProvider: "authenticated",
    /** Onboarding hub — buyers apply here; provider tools use child routes. */
    dashboardProvider: "authenticated",
    dashboardProviderAnalytics: "provider",
    dashboardProviderNodes: "provider",
    dashboardProviderHealth: "provider",
    dashboardProviderCircle: "provider",
    dashboardProviderRelationships: "provider",
    dashboardProviderEarnings: "provider",
    dashboardProviderServices: "provider",
    dashboardProviderSetup: "provider",
    dashboardProviderTokens: "provider",
    dashboardProviderCli: "provider",
    dashboardSettingsAccount: "authenticated",
    dashboardSettingsIdentity: "authenticated",
    dashboardSettingsNotifications: "authenticated",
    dashboardSettingsApiKeys: "authenticated",
    dashboardSettingsDevices: "authenticated",
    dashboardSettingsSecurity: "authenticated",
    communityFeed: "authenticated",
    communityForum: "public",
    communityForumRecent: "public",
    communityForumPopular: "public",
    communityForumUnanswered: "public",
    communityForumMyPosts: "authenticated",
    communityForumNew: "authenticated",
    communityMessages: "authenticated",
    communityBeta: "public",
    communityFriends: "authenticated",
    communityReferrals: "authenticated",
    explorer: "public",
    explorerMap: "public",
    explorerNodes: "public",
    explorerNodeCompare: "public",
    explorerTransactions: "public",
    explorerBlocks: "public",
    explorerWallets: "public",
    explorerContracts: "public",
    explorerSessions: "public",
    explorerAnalytics: "public",
    explorerHealth: "public",
    explorerEarnings: "public",
    explorerLeaderboard: "public",
    explorerSearch: "public",
    governance: "public",
    governanceCreate: "authenticated",
    treasury: "public",
    settings: "authenticated",
    settingsNotifications: "authenticated",
    profile: "authenticated",
    leaderboards: "public",
    login: "public",
    register: "public",
    onboarding: "authenticated",
    help: "public",
    /** External docs host — listed for RouteKey completeness; not an in-app path. */
    docs: "public",
    guidelines: "public",
    contact: "public",
    terms: "public",
    privacy: "public",
    extensionPrivacy: "public",
};

const ROUTE_POLICY_PATH_OVERRIDES: Array<{ prefix: string; policy: RoutePolicy }> = [
    { prefix: "/profile/", policy: "public" },
    { prefix: "/marketplace/", policy: "public" },
    { prefix: "/providers/", policy: "public" },
    { prefix: "/governance/", policy: "public" },
    { prefix: "/explorer/nodes/", policy: "public" },
    { prefix: "/explorer/contracts/", policy: "public" },
    { prefix: "/explorer/wallets/", policy: "public" },
    { prefix: "/explorer/blocks/", policy: "public" },
    { prefix: "/explorer/transactions/", policy: "public" },
    { prefix: "/community/forum/category/", policy: "public" },
    { prefix: "/community/forum/thread/", policy: "public" },
    { prefix: "/dashboard/wallet/callback", policy: "authenticated" },
];

export function getRoutePolicyByKey(routeKey: RouteKey): RoutePolicy {
    return ROUTE_POLICIES[routeKey];
}

/** Exact paths that must not inherit a parent route policy (e.g. /dashboard → authenticated). */
const EXACT_PATH_POLICY_OVERRIDES: Record<string, RoutePolicy> = {
    "/dashboard/provider": "authenticated",
    "/dashboard/become-provider": "authenticated",
};

export function getRoutePolicyForPathname(pathname: string): RoutePolicy {
    const normalizedPath = normalizePath(pathname);
    const exactOverride = EXACT_PATH_POLICY_OVERRIDES[normalizedPath];
    if (exactOverride) return exactOverride;

    const routeEntries = getStaticRouteEntries();
    const exactEntry = routeEntries.find(([, route]) => normalizePath(route) === normalizedPath);
    if (exactEntry) return ROUTE_POLICIES[exactEntry[0]];

    const override = ROUTE_POLICY_PATH_OVERRIDES.find(entry => normalizedPath.startsWith(entry.prefix));
    if (override) return override.policy;

    const matchingEntry = routeEntries
        .filter(([, route]) => {
            const normalizedRoute = normalizePath(route);
            return normalizedPath === normalizedRoute || normalizedPath.startsWith(`${normalizedRoute}/`);
        })
        .sort(([, leftRoute], [, rightRoute]) => normalizePath(rightRoute).length - normalizePath(leftRoute).length)[0];

    if (!matchingEntry) return "public";
    return ROUTE_POLICIES[matchingEntry[0]];
}

export function isRoleAllowedForPolicy(role: string | undefined, policy: RoutePolicy): boolean {
    if (policy === "public") return true;

    const normalizedRole = role?.trim().toLowerCase();
    if (!normalizedRole) return false;

    if (policy === "authenticated") return true;
    if (policy === "provider") return normalizedRole === "provider" || normalizedRole === "both" || normalizedRole === "admin";
    if (policy === "admin") return normalizedRole === "admin" || normalizedRole === "moderator" || normalizedRole === "superadmin";

    return false;
}

export function normalizePath(pathname: string): string {
    return pathname.split(/[?#]/)[0].replace(/\/$/, "") || "/";
}
