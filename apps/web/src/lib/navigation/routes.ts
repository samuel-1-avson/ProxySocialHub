export const ROUTES = {
    home: "/",
    marketplace: "/marketplace",
    network: "/network",
    marketplaceMap: "/marketplace/map",
    marketplaceCatalog: "/marketplace/manage/products",
    marketplaceCreate: "/marketplace/create",
    marketplaceManage: "/marketplace/manage",
    marketplaceOrders: "/marketplace/orders",
    marketplaceOrder: (id: string) => `/marketplace/orders/${id}`,
    marketplaceSaved: "/marketplace/saved",
    /** Canonical agents IA (legacy `/marketplace/agents*` redirects here). */
    marketplaceAgents: "/agents",
    marketplaceAgentInstances: "/agents/instances",
    dashboard: "/dashboard",
    dashboardAdmin: "/dashboard/admin",
    dashboardAgents: "/dashboard/agents",
    dashboardAnalytics: "/dashboard/analytics",
    dashboardFeed: "/dashboard/feed",
    dashboardMessages: "/dashboard/messages",
    dashboardMonitoring: "/dashboard/monitoring",
    dashboardProfile: "/dashboard/profile",
    dashboardProxy: "/dashboard/proxy",
    dashboardOrder: (id: string) => `/dashboard/orders/${id}`,
    dashboardSecurity: "/dashboard/security",
    dashboardSessions: "/dashboard/sessions",
    dashboardUsage: "/dashboard/usage",
    dashboardSubscriptions: "/dashboard/subscriptions",
    dashboardTrustless: "/dashboard/trustless",
    dashboardWallet: "/dashboard/wallet",
    dashboardBecomeProvider: "/dashboard/become-provider",
    dashboardProvider: "/dashboard/provider",
    dashboardProviderAnalytics: "/dashboard/provider/analytics",
    dashboardProviderNodes: "/dashboard/provider/nodes",
    dashboardProviderHealth: "/dashboard/provider/health",
    dashboardProviderCircle: "/dashboard/provider/circle",
    dashboardProviderRelationships: "/dashboard/provider/relationships",
    dashboardProviderEarnings: "/dashboard/provider/earnings",
    dashboardProviderServices: "/dashboard/provider/services",
    dashboardProviderSetup: "/dashboard/provider/setup",
    dashboardProviderTokens: "/dashboard/provider/tokens",
    dashboardProviderCli: "/dashboard/provider/cli",
    dashboardSettingsAccount: "/dashboard/settings/account",
    dashboardSettingsIdentity: "/dashboard/settings/identity",
    dashboardSettingsNotifications: "/dashboard/settings/notifications",
    dashboardSettingsApiKeys: "/dashboard/settings/api-keys",
    dashboardSettingsDevices: "/dashboard/settings/devices",
    dashboardSettingsSecurity: "/dashboard/settings/security",
    communityFeed: "/community/feed",
    communityForum: "/community/forum",
    communityForumRecent: "/community/forum/recent",
    communityForumPopular: "/community/forum/popular",
    communityForumUnanswered: "/community/forum/unanswered",
    communityForumMyPosts: "/community/forum/my-posts",
    communityForumNew: "/community/forum/new",
    communityMessages: "/community/messages",
    communityBeta: "/community/beta",
    explorer: "/explorer",
    explorerMap: "/explorer/map",
    explorerNodes: "/explorer/nodes",
    explorerNodeCompare: "/explorer/nodes/compare",
    explorerTransactions: "/explorer/transactions",
    explorerBlocks: "/explorer/blocks",
    explorerWallets: "/explorer/wallets",
    explorerContracts: "/explorer/contracts",
    explorerSessions: "/explorer/sessions",
    explorerAnalytics: "/explorer/analytics",
    explorerHealth: "/explorer/health",
    explorerEarnings: "/explorer/earnings",
    explorerLeaderboard: "/explorer/leaderboard",
    explorerSearch: "/explorer/search",
    governance: "/governance",
    governanceCreate: "/governance/create",
    treasury: "/treasury",
    /** Legacy path; `/settings` redirects to dashboard settings. */
    settings: "/settings",
    settingsNotifications: "/settings/notifications",
    profile: "/profile",
    leaderboards: "/leaderboards",
    login: "/login",
    register: "/register",
    help: "/help",
    guidelines: "/guidelines",
    contact: "/contact",
    terms: "/terms",
    privacy: "/privacy",
} as const;

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];
export type StaticAppRoute = Exclude<AppRoute, (...args: never[]) => string>;
export type StaticRouteKey = {
    [K in keyof typeof ROUTES]: (typeof ROUTES)[K] extends string ? K : never;
}[keyof typeof ROUTES];

export function isStaticAppRoute(route: AppRoute): route is StaticAppRoute {
    return typeof route === "string";
}

export function getStaticRouteEntries(): Array<[keyof typeof ROUTES, StaticAppRoute]> {
    return Object.entries(ROUTES).filter((entry): entry is [keyof typeof ROUTES, StaticAppRoute] =>
        isStaticAppRoute(entry[1]),
    );
}

export function isNavigationRouteActive(pathname: string | null | undefined, route: string): boolean {
    if (!pathname) return false;

    const currentPath = pathname.split(/[?#]/)[0].replace(/\/$/, "") || "/";
    const targetRoute = route.split(/[?#]/)[0].replace(/\/$/, "") || "/";

    if (currentPath === targetRoute) return true;
    if (targetRoute === "/" || !currentPath.startsWith(`${targetRoute}/`)) return false;

    const hasMoreSpecificRegisteredRoute = getStaticRouteEntries()
        .map(([, candidate]) => candidate)
        .filter(candidate => candidate !== targetRoute && candidate.startsWith(`${targetRoute}/`))
        .some(candidate => {
            const normalizedCandidate = candidate.replace(/\/$/, "");
            return currentPath === normalizedCandidate || currentPath.startsWith(`${normalizedCandidate}/`);
        });

    return !hasMoreSpecificRegisteredRoute;
}

export interface RouteLabel {
    label: string;
    breadcrumb?: string;
}

export const ROUTE_LABELS: Record<string, RouteLabel> = {
    [ROUTES.home]: { label: "Home", breadcrumb: "Home" },
    [ROUTES.marketplace]: { label: "Marketplace" },
    [ROUTES.network]: { label: "Network", breadcrumb: "Network" },
    [ROUTES.marketplaceMap]: { label: "Marketplace map", breadcrumb: "Map" },
    [ROUTES.marketplaceCatalog]: { label: "Catalog products", breadcrumb: "Catalog" },
    [ROUTES.marketplaceCreate]: { label: "Create Listing", breadcrumb: "Create" },
    [ROUTES.marketplaceManage]: { label: "My Listings", breadcrumb: "Listings" },
    [ROUTES.marketplaceAgents]: { label: "Rent agents", breadcrumb: "Agents" },
    [ROUTES.marketplaceAgentInstances]: { label: "My agents", breadcrumb: "Instances" },
    [ROUTES.dashboard]: { label: "Dashboard", breadcrumb: "System" },
    [ROUTES.dashboardAdmin]: { label: "Admin", breadcrumb: "Admin" },
    [ROUTES.dashboardAgents]: { label: "Agent console", breadcrumb: "Agents" },
    [ROUTES.dashboardAnalytics]: { label: "My analytics", breadcrumb: "Analytics" },
    [ROUTES.dashboardFeed]: { label: "Feed (legacy)", breadcrumb: "Feed" },
    [ROUTES.dashboardMessages]: { label: "Messages (legacy)", breadcrumb: "Messages" },
    [ROUTES.dashboardMonitoring]: { label: "Operations", breadcrumb: "Ops" },
    [ROUTES.dashboardProfile]: { label: "Dashboard Profile", breadcrumb: "Profile" },
    [ROUTES.dashboardProxy]: { label: "Connect", breadcrumb: "Proxy" },
    [ROUTES.dashboardSecurity]: { label: "Security (legacy)", breadcrumb: "Security" },
    [ROUTES.dashboardSessions]: { label: "Sessions" },
    [ROUTES.dashboardUsage]: { label: "Usage & Billing", breadcrumb: "Usage" },
    [ROUTES.dashboardSubscriptions]: { label: "Plans & billing", breadcrumb: "Plans" },
    [ROUTES.dashboardTrustless]: { label: "Usage proofs", breadcrumb: "Proofs" },
    [ROUTES.dashboardWallet]: { label: "Wallet" },
    [ROUTES.dashboardBecomeProvider]: { label: "Become a Provider", breadcrumb: "Apply" },
    [ROUTES.dashboardProvider]: { label: "Provider" },
    [ROUTES.dashboardProviderAnalytics]: { label: "Provider Analytics", breadcrumb: "Analytics" },
    [ROUTES.dashboardProviderNodes]: { label: "Node Health", breadcrumb: "Nodes" },
    [ROUTES.dashboardProviderHealth]: { label: "Provider Health", breadcrumb: "Health" },
    [ROUTES.dashboardProviderCircle]: { label: "Circle Pool", breadcrumb: "Circle" },
    [ROUTES.dashboardProviderRelationships]: { label: "Customers", breadcrumb: "Customers" },
    [ROUTES.dashboardProviderEarnings]: { label: "Income", breadcrumb: "Earnings" },
    [ROUTES.dashboardProviderServices]: { label: "Services", breadcrumb: "Services" },
    [ROUTES.dashboardProviderSetup]: { label: "Provider Setup", breadcrumb: "Setup" },
    [ROUTES.dashboardProviderTokens]: { label: "API Tokens", breadcrumb: "Tokens" },
    [ROUTES.dashboardProviderCli]: { label: "CLI & Download", breadcrumb: "CLI" },
    [ROUTES.dashboardSettingsAccount]: { label: "Account & tier", breadcrumb: "Account" },
    [ROUTES.dashboardSettingsIdentity]: { label: "Settings", breadcrumb: "Settings" },
    [ROUTES.dashboardSettingsNotifications]: { label: "Notifications", breadcrumb: "Notifications" },
    [ROUTES.dashboardSettingsApiKeys]: { label: "API keys", breadcrumb: "API keys" },
    [ROUTES.dashboardSettingsDevices]: { label: "Devices", breadcrumb: "Devices" },
    [ROUTES.dashboardSettingsSecurity]: { label: "Security", breadcrumb: "Security" },
    [ROUTES.communityFeed]: { label: "Feed" },
    [ROUTES.communityForum]: { label: "Forum" },
    [ROUTES.communityForumRecent]: { label: "Recent Threads", breadcrumb: "Recent" },
    [ROUTES.communityForumPopular]: { label: "Popular Threads", breadcrumb: "Popular" },
    [ROUTES.communityForumUnanswered]: { label: "Unanswered Threads", breadcrumb: "Unanswered" },
    [ROUTES.communityForumMyPosts]: { label: "My Forum Posts", breadcrumb: "My Posts" },
    [ROUTES.communityForumNew]: { label: "New Thread", breadcrumb: "New" },
    [ROUTES.communityMessages]: { label: "Messages" },
    [ROUTES.communityBeta]: { label: "Beta program", breadcrumb: "Beta" },
    [ROUTES.explorer]: { label: "Explorer" },
    [ROUTES.explorerMap]: { label: "Infrastructure map", breadcrumb: "Map" },
    [ROUTES.explorerNodes]: { label: "Nodes" },
    [ROUTES.explorerNodeCompare]: { label: "Compare Nodes", breadcrumb: "Compare" },
    [ROUTES.explorerTransactions]: { label: "Transactions" },
    [ROUTES.explorerBlocks]: { label: "Blocks" },
    [ROUTES.explorerWallets]: { label: "Wallets" },
    [ROUTES.explorerContracts]: { label: "Contracts" },
    [ROUTES.explorerSessions]: { label: "Public sessions", breadcrumb: "Sessions" },
    [ROUTES.explorerAnalytics]: { label: "Network analytics", breadcrumb: "Analytics" },
    [ROUTES.explorerHealth]: { label: "Network health", breadcrumb: "Health" },
    [ROUTES.explorerEarnings]: { label: "Network earnings", breadcrumb: "Earnings" },
    [ROUTES.explorerLeaderboard]: { label: "Leaderboard", breadcrumb: "Leaderboard" },
    [ROUTES.explorerSearch]: { label: "Explorer Search", breadcrumb: "Search" },
    [ROUTES.governance]: { label: "Governance" },
    [ROUTES.governanceCreate]: { label: "Create Proposal", breadcrumb: "Create" },
    [ROUTES.treasury]: { label: "Treasury" },
    [ROUTES.settings]: { label: "Settings" },
    [ROUTES.settingsNotifications]: { label: "Notification Settings", breadcrumb: "Notifications" },
    [ROUTES.profile]: { label: "Profile" },
    [ROUTES.leaderboards]: { label: "Leaderboard (legacy)" },
    [ROUTES.login]: { label: "Login" },
    [ROUTES.register]: { label: "Register" },
    [ROUTES.help]: { label: "Help Center", breadcrumb: "Help" },
    [ROUTES.guidelines]: { label: "Community Guidelines", breadcrumb: "Guidelines" },
    [ROUTES.contact]: { label: "Contact" },
    [ROUTES.terms]: { label: "Terms of Service", breadcrumb: "Terms" },
    [ROUTES.privacy]: { label: "Privacy Policy", breadcrumb: "Privacy" },
};

export const PRIMARY_PUBLIC_NAV = [
    { href: ROUTES.marketplace, label: "MARKETPLACE" },
];

export const PRIMARY_AUTH_NAV = [
    { href: ROUTES.communityFeed, label: "FEED" },
    { href: ROUTES.explorerLeaderboard, label: "LEADERBOARD" },
    { href: ROUTES.communityMessages, label: "MESSAGES" },
];

export const FOOTER_PLATFORM_LINKS = [
    { href: ROUTES.marketplace, label: "Marketplace" },
    { href: ROUTES.communityFeed, label: "Activity Feed" },
    { href: `${ROUTES.register}?role=provider`, label: "Become a Seller" },
];

export const FOOTER_SUPPORT_LINKS = [
    { href: ROUTES.help, label: "Help Center" },
    { href: ROUTES.guidelines, label: "Community Guidelines" },
    { href: ROUTES.contact, label: "Contact Us" },
];

export const FOOTER_LEGAL_LINKS = [
    { href: ROUTES.terms, label: "Terms of Service" },
    { href: ROUTES.privacy, label: "Privacy Policy" },
];

export function getRouteLabel(path: string): string {
    return ROUTE_LABELS[path]?.breadcrumb || ROUTE_LABELS[path]?.label || path.replace(/-/g, " ");
}
