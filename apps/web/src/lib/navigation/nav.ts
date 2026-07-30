import {
    Activity,
    BarChart3,
    Bot,
    CircleDot,
    Coins,
    Compass,
    Cpu,
    Fingerprint,
    Globe,
    Landmark,
    LayoutDashboard,
    ListChecks,
    ListOrdered,
    Bookmark,
    MapPin,
    MessageSquare,
    Network,
    Newspaper,
    Plus,
    Radio,
    Server,
    Settings,
    ShieldCheck,
    Store,
    Terminal,
    Trophy,
    User,
    Users,
    Vote,
    Wallet,
    Wifi,
    Layers,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ROUTES } from "@/lib/navigation/routes";
import type { StaticAppRoute, StaticRouteKey } from "@/lib/navigation/routes";
import { getRoutePolicyByKey, type RoutePolicy } from "@/lib/navigation/policies";
import { buildExplorerSidebarNavItems } from "@/lib/navigation/explorer-nav";

export type RouteKey = keyof typeof ROUTES;

export interface NavigationItem {
    id: string;
    routeKey: RouteKey;
    href: StaticAppRoute;
    label: string;
    icon: LucideIcon;
    description?: string;
    policy: RoutePolicy;
    providerBadge?: boolean;
}

export interface NavigationSection {
    id: string;
    title?: string;
    items: NavigationItem[];
}

function navItem(
    routeKey: StaticRouteKey,
    label: string,
    icon: LucideIcon,
    options: {
        id?: string;
        description?: string;
        policy?: RoutePolicy;
        providerBadge?: boolean;
    } = {},
): NavigationItem {
    return {
        id: options.id ?? routeKey,
        routeKey,
        href: ROUTES[routeKey],
        label,
        icon,
        description: options.description,
        policy: options.policy ?? getRoutePolicyByKey(routeKey),
        providerBadge: options.providerBadge,
    };
}

export const NAV_SECTIONS: NavigationSection[] = [
    {
        id: "main",
        title: "Use",
        items: [
            navItem("dashboard", "Dashboard", LayoutDashboard),
            navItem("dashboardProxy", "Connect", Globe, { description: "Create proxy sessions" }),
            navItem("dashboardSessions", "Sessions", Wifi, { description: "Active & history" }),
            navItem("dashboardUsage", "Usage & billing", BarChart3, { description: "Bandwidth & billing" }),
            navItem("dashboardSubscriptions", "Plans", Layers, { description: "Subscription & renewals" }),
        ],
    },
    {
        id: "marketplace",
        title: "Market",
        items: [
            navItem("network", "Network", Network, {
                description: "Map preview + live activity",
                policy: "public",
            }),
            navItem("marketplace", "Browse listings", Store, { policy: "public" }),
            navItem("marketplaceMap", "Marketplace map", MapPin, {
                description: "Buy proxies by location",
                policy: "public",
            }),
            navItem("marketplaceOrders", "My orders", ListOrdered, { description: "Purchases & escrow status", policy: "authenticated" }),
            navItem("marketplaceSaved", "Saved listings", Bookmark, { description: "Bookmarked offers", policy: "authenticated" }),
            navItem("marketplaceAgents", "Rent agents", Bot, { policy: "public" }),
            navItem("marketplaceAgentInstances", "My agents", Cpu, { description: "Deployed instances" }),
            navItem("marketplaceCreate", "Create listing", Plus, { policy: "provider", providerBadge: true }),
            navItem("marketplaceManage", "Manage listings", ListChecks, { policy: "provider", providerBadge: true }),
            navItem("marketplaceCatalog", "Catalog products", Store, {
                description: "Merchandising layer",
                policy: "provider",
                providerBadge: true,
            }),
        ],
    },
    {
        id: "advanced",
        title: "Advanced",
        items: [
            navItem("dashboardTrustless", "Usage proofs", ShieldCheck, { description: "Trustless integrity checks" }),
            navItem("dashboardAgents", "Agent console", Bot, { description: "Operate rented agents" }),
            navItem("dashboardAnalytics", "My analytics", BarChart3, { description: "Your usage & network stats" }),
            navItem("dashboardMonitoring", "Operations", Activity, { description: "Infrastructure monitoring" }),
        ],
    },
    {
        id: "provider",
        title: "Provider",
        items: [
            navItem("dashboardBecomeProvider", "Become a provider", Server, {
                description: "Apply to share bandwidth and earn SOL",
                policy: "authenticated",
            }),
            navItem("dashboardProvider", "Provider hub", Server, {
                description: "Apply, nodes, earnings, setup",
                policy: "authenticated",
                providerBadge: true,
            }),
            navItem("dashboardProviderSetup", "Setup", Compass, {
                description: "Token + first node",
                policy: "provider",
            }),
            navItem("dashboardProviderTokens", "API tokens", Fingerprint, {
                description: "CLI authentication",
                policy: "provider",
            }),
            navItem("dashboardProviderCli", "CLI & download", Terminal, {
                description: "Provider software",
                policy: "provider",
            }),
            navItem("dashboardProviderNodes", "My nodes", Radio, {
                description: "Register & manage nodes",
                policy: "provider",
            }),
            navItem("dashboardProviderHealth", "Node diagnostics", Activity, {
                description: "Health check results",
                policy: "provider",
            }),
            navItem("dashboardProviderAnalytics", "Provider stats", BarChart3, {
                description: "Performance & revenue",
                policy: "provider",
            }),
            navItem("dashboardProviderEarnings", "Income", Coins, {
                description: "Earnings & payouts",
                policy: "provider",
            }),
            navItem("dashboardProviderServices", "Services", Network, {
                description: "Advanced service configs",
                policy: "provider",
            }),
            navItem("dashboardProviderCircle", "Circle pool", CircleDot, {
                description: "Enterprise pooling",
                policy: "provider",
            }),
            navItem("dashboardProviderRelationships", "Customers", Users, {
                description: "Buyer relationships",
                policy: "provider",
            }),
        ],
    },
    {
        id: "community",
        title: "Community",
        items: [
            navItem("communityFeed", "Feed", Newspaper, { policy: "public" }),
            navItem("communityForum", "Forum", MessageSquare, { policy: "public", description: "Discussions & support" }),
            navItem("communityMessages", "Messages", MessageSquare, { description: "Direct messages" }),
            navItem("communityBeta", "Beta program", Trophy, { policy: "public", description: "DevNet testing tasks" }),
            navItem("explorerLeaderboard", "Leaderboard", Trophy, { policy: "public", description: "Top nodes & providers" }),
        ],
    },
    {
        id: "explorer",
        title: "Explorer",
        items: buildExplorerSidebarNavItems().map(({ routeKey, label, icon }) =>
            navItem(routeKey, label, icon, { policy: "public" }),
        ),
    },
    {
        id: "governance",
        title: "Governance",
        items: [
            navItem("governance", "Proposals", Vote, { policy: "public" }),
            navItem("governanceCreate", "Create proposal", Plus),
            navItem("treasury", "Treasury", Landmark, { policy: "public", description: "On-chain transparency" }),
        ],
    },
];

export const SIDEBAR_BOTTOM_ITEMS: NavigationItem[] = [
    navItem("dashboardWallet", "Wallet", Wallet),
    navItem("dashboardSettingsIdentity", "Settings", Settings, { description: "Profile & security" }),
    navItem("profile", "Profile", User, { description: "Public profile" }),
];

export const MOBILE_ACCOUNT_SECTION: NavigationSection = {
    id: "account",
    title: "Account",
    items: SIDEBAR_BOTTOM_ITEMS,
};

export const MOBILE_MORE_SECTIONS: NavigationSection[] = [
    ...NAV_SECTIONS.filter(section => section.id !== "main"),
    MOBILE_ACCOUNT_SECTION,
];

export function getMobilePrimaryTabs(options: { isProvider: boolean; isConsumer: boolean }): NavigationItem[] {
    const tabs = [navItem("dashboard", "Home", LayoutDashboard)];

    if (options.isProvider && !options.isConsumer) {
        tabs.push(navItem("dashboardProviderNodes", "Nodes", Server, { policy: "provider" }));
        tabs.push(navItem("dashboardProviderEarnings", "Earn", Coins, { policy: "provider" }));
    } else {
        tabs.push(navItem("dashboardProxy", "Connect", Globe));
        tabs.push(navItem("marketplace", "Market", Store, { policy: "public" }));
    }

    tabs.push(navItem("communityForum", "Forum", MessageSquare, { policy: "public" }));
    return tabs;
}

export function getNavigationBadge(item: NavigationItem, options: { isProvider: boolean; isDualRole: boolean }): string | undefined {
    if (!item.providerBadge) return undefined;
    return options.isProvider || options.isDualRole ? undefined : "provider";
}
