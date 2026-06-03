import {
    ArrowRightLeft,
    BarChart3,
    Blocks,
    Coins,
    FileCode,
    Grid,
    MapPin,
    Radio,
    Search,
    Server,
    ShieldCheck,
    Trophy,
    Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ROUTES, type AppRoute } from '@/lib/navigation/routes';

type ExplorerRouteKey = keyof typeof ROUTES;

const EXPLORER_TAB_ICONS: Record<ExplorerTabId, LucideIcon> = {
    overview: Blocks,
    blocks: Grid,
    nodes: Server,
    transactions: ArrowRightLeft,
    leaderboard: Trophy,
    sessions: Radio,
    earnings: Coins,
    analytics: BarChart3,
    health: ShieldCheck,
    map: MapPin,
    search: Search,
    wallets: Wallet,
    contracts: FileCode,
};

export type ExplorerTabId =
    | 'overview'
    | 'blocks'
    | 'nodes'
    | 'transactions'
    | 'leaderboard'
    | 'sessions'
    | 'earnings'
    | 'analytics'
    | 'health'
    | 'map'
    | 'search'
    | 'wallets'
    | 'contracts';

export interface ExplorerTab {
    id: ExplorerTabId;
    routeKey: ExplorerRouteKey;
    href: AppRoute;
    label: string;
    /** When false, tab is hidden unless the public API flag is enabled. */
    requiresPublicApi?: 'sessions' | 'earnings';
}

function envFlag(name: string, defaultValue = false): boolean {
    const raw = process.env[name]?.trim().toLowerCase();
    if (!raw) return defaultValue;
    return raw === '1' || raw === 'true' || raw === 'yes';
}

/** Mirror control-api defaults: sessions/earnings public feeds are off unless explicitly enabled. */
export function explorerPublicSessionsEnabled(): boolean {
    return envFlag('NEXT_PUBLIC_EXPLORER_PUBLIC_SESSIONS_ENABLED', false);
}

export function explorerPublicEarningsEnabled(): boolean {
    return envFlag('NEXT_PUBLIC_EXPLORER_PUBLIC_EARNINGS_ENABLED', false);
}

/** In-map purchase on /explorer/map (uses BuyListingModal; off by default). */
export function explorerMapBuyEnabled(): boolean {
    return envFlag('NEXT_PUBLIC_EXPLORER_MAP_BUY_ENABLED', false);
}

const ALL_EXPLORER_TABS: ExplorerTab[] = [
    { id: 'overview', routeKey: 'explorer', href: ROUTES.explorer, label: 'Overview' },
    { id: 'blocks', routeKey: 'explorerBlocks', href: ROUTES.explorerBlocks, label: 'Blocks' },
    { id: 'nodes', routeKey: 'explorerNodes', href: ROUTES.explorerNodes, label: 'Nodes' },
    { id: 'transactions', routeKey: 'explorerTransactions', href: ROUTES.explorerTransactions, label: 'Transactions' },
    { id: 'leaderboard', routeKey: 'explorerLeaderboard', href: ROUTES.explorerLeaderboard, label: 'Leaderboard' },
    { id: 'sessions', routeKey: 'explorerSessions', href: ROUTES.explorerSessions, label: 'Sessions', requiresPublicApi: 'sessions' },
    { id: 'earnings', routeKey: 'explorerEarnings', href: ROUTES.explorerEarnings, label: 'Earnings', requiresPublicApi: 'earnings' },
    { id: 'analytics', routeKey: 'explorerAnalytics', href: ROUTES.explorerAnalytics, label: 'Analytics' },
    { id: 'health', routeKey: 'explorerHealth', href: ROUTES.explorerHealth, label: 'Health' },
    { id: 'map', routeKey: 'explorerMap', href: ROUTES.explorerMap, label: 'Network map' },
    { id: 'search', routeKey: 'explorerSearch', href: ROUTES.explorerSearch, label: 'Search' },
    { id: 'wallets', routeKey: 'explorerWallets', href: ROUTES.explorerWallets, label: 'Wallets' },
    { id: 'contracts', routeKey: 'explorerContracts', href: ROUTES.explorerContracts, label: 'Contracts' },
];

function isTabVisible(tab: ExplorerTab): boolean {
    if (tab.requiresPublicApi === 'sessions') {
        return explorerPublicSessionsEnabled();
    }
    if (tab.requiresPublicApi === 'earnings') {
        return explorerPublicEarningsEnabled();
    }
    return true;
}

/** Tabs shown in explorer layout header and sidebar — single source of truth. */
export function getVisibleExplorerTabs(): ExplorerTab[] {
    return ALL_EXPLORER_TABS.filter(isTabVisible);
}

/** Sidebar subset: same visibility rules as layout tabs. */
export function getExplorerSidebarTabs(): ExplorerTab[] {
    return getVisibleExplorerTabs();
}

export function buildExplorerSidebarNavItems(): Array<{
    routeKey: ExplorerRouteKey;
    label: string;
    icon: LucideIcon;
}> {
    return getExplorerSidebarTabs().map((tab) => ({
        routeKey: tab.routeKey,
        label: tab.label,
        icon: EXPLORER_TAB_ICONS[tab.id],
    }));
}
