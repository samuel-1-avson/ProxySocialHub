/** Static nav + fallback search blurbs (safe for client components). */

export type NavChild = { href: string; label: string };
export type NavItem = {
  href: string;
  label: string;
  /** Telemetry rail id shown in sidebar */
  code?: string;
  children?: NavChild[];
};

export const NAV: NavItem[] = [
  { href: '/docs', label: 'Overview', code: '00' },
  { href: '/docs/getting-started', label: 'Getting started', code: '01' },
  {
    href: '/docs/quickstart/buyer',
    label: 'Quickstarts',
    code: '02',
    children: [
      { href: '/docs/quickstart/buyer', label: 'Buyer (5 min)' },
      { href: '/docs/quickstart/provider', label: 'Provider (10 min)' },
    ],
  },
  {
    href: '/docs/concepts',
    label: 'Concepts',
    code: '03',
    children: [
      { href: '/docs/concepts', label: 'Overview' },
      { href: '/docs/concepts/access-paths', label: 'Access paths' },
      { href: '/docs/concepts/escrow', label: 'Escrow & orders' },
      { href: '/docs/concepts/metering', label: 'Metering' },
    ],
  },
  { href: '/docs/architecture', label: 'Architecture', code: '04' },
  {
    href: '/docs/wallet/auth',
    label: 'Wallet',
    code: '05',
    children: [
      { href: '/docs/wallet/auth', label: 'Authentication' },
      { href: '/docs/wallet/deposit-withdraw', label: 'Deposit & withdraw' },
    ],
  },
  {
    href: '/docs/buyer/proxy',
    label: 'Buyer',
    code: '06',
    children: [
      { href: '/docs/buyer/proxy', label: 'Proxy protocol' },
      { href: '/docs/buyer/connect', label: 'Session intents' },
      { href: '/docs/buyer/credentials', label: 'Order credentials' },
      { href: '/docs/buyer/pools', label: 'Bulk pools' },
    ],
  },
  {
    href: '/docs/sdks',
    label: 'SDKs',
    code: '07',
    children: [
      { href: '/docs/sdks', label: 'Overview' },
      { href: '/docs/sdks/python', label: 'Python' },
      { href: '/docs/sdks/nodejs', label: 'Node.js' },
      { href: '/docs/sdks/go', label: 'Go' },
    ],
  },
  { href: '/docs/api', label: 'API reference', code: '08' },
  {
    href: '/docs/marketplace',
    label: 'Marketplace',
    code: '09',
    children: [
      { href: '/docs/marketplace', label: 'Overview' },
      { href: '/docs/marketplace/discovery', label: 'Discovery' },
      { href: '/docs/marketplace/orders', label: 'Orders' },
      { href: '/docs/marketplace/b2b', label: 'B2B' },
      { href: '/docs/marketplace/subscriptions', label: 'Access Passes' },
    ],
  },
  {
    href: '/docs/provider/cli',
    label: 'Provider',
    code: '10',
    children: [
      { href: '/docs/provider/cli', label: 'CLI' },
      { href: '/docs/provider/nodes', label: 'Nodes' },
    ],
  },
  { href: '/docs/troubleshooting', label: 'Troubleshooting', code: '11' },
  { href: '/docs/changelog', label: 'Changelog', code: '12' },
  { href: '/docs/whitepaper', label: 'Whitepaper v2.0', code: '13' },
];

export type FlatNavItem = { href: string; label: string; section: string };

/** Flatten NAV for prev/next and search section labels. */
export function flattenNav(): FlatNavItem[] {
  const out: FlatNavItem[] = [];
  for (const item of NAV) {
    if (item.children?.length) {
      for (const child of item.children) {
        out.push({ href: child.href, label: child.label, section: item.label });
      }
    } else {
      out.push({ href: item.href, label: item.label, section: 'Overview' });
    }
  }
  return out;
}

export function getAdjacent(href: string): {
  prev: FlatNavItem | null;
  next: FlatNavItem | null;
} {
  const flat = flattenNav();
  const i = flat.findIndex((e) => e.href === href);
  if (i < 0) return { prev: null, next: null };
  return {
    prev: i > 0 ? flat[i - 1] : null,
    next: i < flat.length - 1 ? flat[i + 1] : null,
  };
}

export type Crumb = { href: string; label: string };

/** Breadcrumb trail for a docs path. */
export function getBreadcrumbs(href: string): Crumb[] {
  const crumbs: Crumb[] = [{ href: '/docs', label: 'Docs' }];
  if (href === '/docs') return crumbs;

  for (const item of NAV) {
    if (!item.children?.length) {
      if (item.href === href) {
        crumbs.push({ href: item.href, label: item.label });
        return crumbs;
      }
      continue;
    }
    const child = item.children.find((c) => c.href === href);
    if (!child) continue;
    crumbs.push({ href: item.children[0].href, label: item.label });
    if (child.label !== item.label) {
      crumbs.push({ href: child.href, label: child.label });
    }
    return crumbs;
  }

  return crumbs;
}

/** Whether a nav group contains the active path. */
export function navGroupActive(item: NavItem, current: string): boolean {
  if (!item.children?.length) return item.href === current;
  return item.children.some((c) => c.href === current || current.startsWith(c.href + '/'));
}

export type SearchEntry = {
  href: string;
  title: string;
  description: string;
  section: string;
  text?: string;
};

/** Lightweight fallback when search-index.json is unavailable. */
export const SEARCH_INDEX: SearchEntry[] = flattenNav().map((e) => ({
  href: e.href,
  title: e.label,
  description: e.section,
  section: e.section,
}));
