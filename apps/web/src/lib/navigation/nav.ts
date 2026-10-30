import {
    Activity,
    BarChart3,
    Bot,
    CircleDot,
    Coins,
    Compass,
    Fingerprint,
    Gift,
    Inbox,
    Landmark,
    LayoutDashboard,
    ListChecks,
    ListOrdered,
    Bookmark,
    BookOpen,
    FlaskConical,
    Pickaxe,
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
    /** Early preview: listed under "Coming soon" with a Soon badge. */
    comingSoon?: boolean;
    /** Extra routes that should mark this item active (e.g. Discover covers Map). */
    activeRouteKeys?: StaticRouteKey[];
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
        comingSoon?: boolean;
        activeRouteKeys?: StaticRouteKey[];
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
        comingSoon: options.comingSoon,
        activeRouteKeys: options.activeRouteKeys,
    };
}

export const NAV_SECTIONS: NavigationSection[] = [
    {
        id: "main",
        title: "Use",
        items: [
            navItem("dashboard", "Dashboard", LayoutDashboard),
            navItem("dashboardSessions", "Sessions", Wifi, { description: "Live and past connections" }),
            navItem("dashboardUsage", "Usage & billing", BarChart3, { description: "What you used and paid" }),
            navItem("dashboardSubscriptions", "Access Passes", Layers, { description: "Monthly bandwidth plans" }),
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
            navItem("marketplace", "Discover", Compass, {
                description: "Browse proxy listings",
                policy: "public",
                activeRouteKeys: ["marketplaceMap"],
            }),
            navItem("marketplaceOrders", "Orders", ListOrdered, {
                description: "Your plans and purchases",
                policy: "authenticated",
            }),
            navItem("marketplaceSaved", "Saved", Bookmark, {
                description: "Listings you saved",
                policy: "authenticated",
            }),
        ],
    },
    {
        id: "sell",
        title: "Sell",
        items: [
            navItem("marketplaceCreate", "Create listing", Plus, { policy: "provider", providerBadge: true }),
            navItem("marketplaceManage", "My listings", ListChecks, {
                description: "Manage offers & products",
                policy: "provider",
                providerBadge: true,
                activeRouteKeys: ["marketplaceCatalog"],
            }),
            navItem("marketplaceMap", "Provider map", MapPin, {
                id: "sellSupplyMap",
                description: "See where listings appear globally",
                // Must match ROUTE_POLICIES.marketplaceMap — map is a public discovery surface.
                policy: "public",
                providerBadge: true,
            }),
        ],
    },
    {
        id: "advanced",
        title: "Insights",
        items: [
            navItem("dashboardAnalytics", "My analytics", BarChart3, { description: "Your usage and network stats" }),
            navItem("dashboardMonitoring", "Operations", Activity, { description: "Admin: infrastructure health" }),
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
            navItem("dashboardProviderAnalytics", "Provider stats", BarChart3, {
                description: "Performance and revenue",
                policy: "provider",
            }),
            navItem("dashboardProviderEarnings", "Income", Coins, {
                description: "Earnings and payouts",
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
            navItem("communityForum", "Forum", MessageSquare, {
                policy: "public",
                description: "Questions and support",
            }),
            navItem("communityMessages", "Messages", Inbox, {
                description: "Direct messages",
            }),
            navItem("communityFeed", "Activity", Newspaper, {
                description: "People you follow"
            }),
            navItem("communityReferrals", "Invite", Gift, {
                description: "Invite & earn",
            }),
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
        id: "soon",
        title: "Coming soon",
        items: [
            navItem("governance", "Governance", Vote, {
                description: "Vote on how the network is run",
                policy: "public",
                comingSoon: true,
            }),
            navItem("governanceCreate", "Create proposal", Plus, { comingSoon: true }),
            navItem("treasury", "Treasury", Landmark, {
                description: "Where platform funds are held",
                policy: "public",
                comingSoon: true,
            }),
            navItem("dashboardTrustless", "Usage proofs", ShieldCheck, {
                description: "Verifiable records of your usage",
                comingSoon: true,
            }),
            navItem("dashboardAgents", "Agent console", Bot, {
                description: "Run automated agents on the network",
                comingSoon: true,
            }),
            navItem("depin", "Mining portal", Pickaxe, {
                description: "Earn by running network infrastructure",
                policy: "public",
                comingSoon: true,
            }),
            navItem("whitepaper", "Whitepaper", BookOpen, {
                description: "How the protocol works",
                policy: "public",
                comingSoon: true,
            }),
            navItem("communityBeta", "Beta program", FlaskConical, {
                description: "Test new features early",
                policy: "public",
                comingSoon: true,
            }),
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
        tabs.push(navItem("marketplace", "Market", Store, { policy: "public" }));
        tabs.push(navItem("marketplaceOrders", "Orders", ListOrdered, { policy: "authenticated" }));
    }

    tabs.push(navItem("communityForum", "Forum", MessageSquare, { policy: "public" }));
    return tabs;
}

export function getNavigationBadge(item: NavigationItem, options: { isProvider: boolean; isDualRole: boolean }): string | undefined {
    if (item.comingSoon) return "Soon";
    if (!item.providerBadge) return undefined;
    return options.isProvider || options.isDualRole ? undefined : "provider";
}
