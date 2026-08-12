/** Static nav + fallback search blurbs (safe for client components). */

export type NavChild = { href: string; label: string };
export type NavItem = {
  href: string;
  label: string;
  children?: NavChild[];
};

export const NAV: NavItem[] = [
  { href: '/docs', label: 'Overview' },
  { href: '/docs/getting-started', label: 'Getting started' },
  {
    href: '/docs/quickstart/buyer',
    label: 'Quickstarts',
    children: [
      { href: '/docs/quickstart/buyer', label: 'Buyer (5 min)' },
      { href: '/docs/quickstart/provider', label: 'Provider (10 min)' },
    ],
  },
  {
    href: '/docs/concepts',
    label: 'Concepts',
    children: [
      { href: '/docs/concepts', label: 'Overview' },
      { href: '/docs/concepts/access-paths', label: 'Access paths' },
      { href: '/docs/concepts/escrow', label: 'Escrow & orders' },
      { href: '/docs/concepts/metering', label: 'Metering' },
    ],
  },
  { href: '/docs/architecture', label: 'Architecture' },
  {
    href: '/docs/wallet/auth',
    label: 'Wallet',
    children: [
      { href: '/docs/wallet/auth', label: 'Authentication' },
      { href: '/docs/wallet/deposit-withdraw', label: 'Deposit & withdraw' },
    ],
  },
  {
    href: '/docs/buyer/proxy',
    label: 'Buyer',
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
    children: [
      { href: '/docs/sdks', label: 'Overview' },
      { href: '/docs/sdks/python', label: 'Python' },
      { href: '/docs/sdks/nodejs', label: 'Node.js' },
      { href: '/docs/sdks/go', label: 'Go' },
    ],
  },
  { href: '/docs/api', label: 'API reference' },
  {
    href: '/docs/marketplace',
    label: 'Marketplace',
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
    children: [
      { href: '/docs/provider/cli', label: 'CLI' },
      { href: '/docs/provider/nodes', label: 'Nodes' },
    ],
  },
  { href: '/docs/troubleshooting', label: 'Troubleshooting' },
  { href: '/docs/changelog', label: 'Changelog' },
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
