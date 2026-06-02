export const ROUTES = {
    home: "/",
    marketplace: "/marketplace",
    marketplaceMap: "/marketplace/map",
    marketplaceCreate: "/marketplace/create",
    marketplaceManage: "/marketplace/manage",
    marketplaceAgents: "/marketplace/agents",
    marketplaceAgentInstances: "/marketplace/agents/instances",
    dashboard: "/dashboard",
    dashboardProxy: "/dashboard/proxy",
    dashboardSessions: "/dashboard/sessions",
    dashboardUsage: "/dashboard/usage",
    dashboardTrustless: "/dashboard/trustless",
    dashboardWallet: "/dashboard/wallet",
    dashboardProvider: "/dashboard/provider",
    dashboardProviderNodes: "/dashboard/provider/nodes",
    dashboardProviderCircle: "/dashboard/provider/circle",
    dashboardProviderRelationships: "/dashboard/provider/relationships",
    dashboardProviderEarnings: "/dashboard/provider/earnings",
    dashboardProviderTokens: "/dashboard/provider/tokens",
    dashboardProviderCli: "/dashboard/provider/cli",
    communityFeed: "/community/feed",
    communityForum: "/community/forum",
    communityMessages: "/community/messages",
    explorer: "/explorer",
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

export interface RouteLabel {
    label: string;
    breadcrumb?: string;
}

export const ROUTE_LABELS: Record<string, RouteLabel> = {
    [ROUTES.home]: { label: "Home", breadcrumb: "Home" },
    [ROUTES.marketplace]: { label: "Marketplace" },
    [ROUTES.marketplaceMap]: { label: "Marketplace Map", breadcrumb: "Map" },
    [ROUTES.marketplaceCreate]: { label: "Create Listing", breadcrumb: "Create" },
    [ROUTES.marketplaceManage]: { label: "My Listings", breadcrumb: "Listings" },
    [ROUTES.marketplaceAgents]: { label: "AI Agents", breadcrumb: "Agents" },
    [ROUTES.marketplaceAgentInstances]: { label: "Agent Instances", breadcrumb: "Instances" },
    [ROUTES.dashboard]: { label: "Dashboard", breadcrumb: "System" },
    [ROUTES.dashboardProxy]: { label: "Connect", breadcrumb: "Proxy" },
    [ROUTES.dashboardSessions]: { label: "Sessions" },
    [ROUTES.dashboardUsage]: { label: "Usage & Billing", breadcrumb: "Usage" },
    [ROUTES.dashboardTrustless]: { label: "Integrity", breadcrumb: "Trustless" },
    [ROUTES.dashboardWallet]: { label: "Wallet" },
    [ROUTES.dashboardProvider]: { label: "Provider" },
    [ROUTES.dashboardProviderNodes]: { label: "Node Health", breadcrumb: "Nodes" },
    [ROUTES.dashboardProviderCircle]: { label: "Circle Pool", breadcrumb: "Circle" },
    [ROUTES.dashboardProviderRelationships]: { label: "Customers", breadcrumb: "Customers" },
    [ROUTES.dashboardProviderEarnings]: { label: "Income", breadcrumb: "Earnings" },
    [ROUTES.dashboardProviderTokens]: { label: "API Tokens", breadcrumb: "Tokens" },
    [ROUTES.dashboardProviderCli]: { label: "CLI & Download", breadcrumb: "CLI" },
    [ROUTES.communityFeed]: { label: "Feed" },
    [ROUTES.communityForum]: { label: "Forum" },
    [ROUTES.communityMessages]: { label: "Messages" },
    [ROUTES.explorer]: { label: "Explorer" },
    [ROUTES.settings]: { label: "Settings" },
    [ROUTES.settingsNotifications]: { label: "Notification Settings", breadcrumb: "Notifications" },
    [ROUTES.profile]: { label: "Profile" },
    [ROUTES.leaderboards]: { label: "Leaderboards" },
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
    { href: ROUTES.leaderboards, label: "LEADERBOARDS" },
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
