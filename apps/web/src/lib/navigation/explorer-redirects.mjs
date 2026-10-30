/**
 * Public Explorer lives on its own site. Main-site /explorer paths only redirect there.
 * @type {string}
 */
export const STANDALONE_EXPLORER_ORIGIN = 'https://explorer.proxyhubb.com';

/**
 * Redirect public record routes, then any leftover /explorer path, once an origin is configured.
 * @param {string | undefined} configured
 */
export function explorerRedirects(configured) {
  if (!configured?.trim()) return [];
  const url = new URL(configured.trim());
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error('NEXT_PUBLIC_EXPLORER_URL must be an HTTPS origin.');
  }
  const aliases = [
    ['/explorer', '/'],
    ['/explorer/map', '/nodes?view=map'],
    ['/explorer/leaderboard', '/nodes?view=rankings'],
    ['/explorer/wallets', '/search?type=wallets'],
    ['/explorer/contracts', '/search?type=contracts'],
    ['/explorer/nodes/compare', '/nodes?view=compare'],
    ['/explorer/about/protocol', '/about'],
    ['/explorer/about', '/about'],
    ['/treasury', '/governance/treasury'],
  ];
  for (const section of ['nodes', 'transactions', 'blocks', 'analytics', 'health', 'search']) {
    aliases.push([`/explorer/${section}`, `/${section}`]);
  }
  for (const section of ['nodes', 'transactions', 'blocks', 'wallets', 'contracts']) {
    aliases.push([`/explorer/${section}/:id`, `/${section}/:id`]);
  }
  aliases.push(['/explorer/:path*', '/']);
  return aliases.map(([source, target]) => ({
    source,
    destination: `${url.origin}${target}`,
    // Temporary while validating the independent production service.
    permanent: false,
  }));
}

/**
 * Resolve one public Explorer path to the standalone origin.
 * Returns null for routes that stay on the main app.
 * @param {string | undefined} configured
 * @param {string} pathname
 * @param {string} [search]
 */
export function matchExplorerRedirect(configured, pathname, search = '') {
  const origin = explorerOrigin(configured);
  const rules = explorerRedirects(origin);
  const pathParts = pathname.split('/').filter(Boolean);
  let destination;
  for (const rule of rules) {
    if (rule.source.includes('*')) continue;
    const sourceParts = rule.source.split('/').filter(Boolean);
    if (sourceParts.length !== pathParts.length) continue;
    const params = {};
    let matched = true;
    for (let index = 0; index < sourceParts.length; index += 1) {
      const token = sourceParts[index];
      if (token.startsWith(':')) {
        try {
          params[token.slice(1)] = decodeURIComponent(pathParts[index]);
        } catch {
          matched = false;
          break;
        }
      } else if (token !== pathParts[index]) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    destination = new URL(rule.destination);
    destination.pathname = destination.pathname.replace(/:([A-Za-z0-9_]+)/g, (_, name) =>
      encodeURIComponent(params[name] ?? ''),
    );
    break;
  }
  if (!destination && (pathname === '/explorer' || pathname.startsWith('/explorer/'))) {
    destination = new URL('/', origin);
  }
  if (!destination) return null;
  const incoming = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  incoming.forEach((value, key) => {
    if (!destination.searchParams.has(key)) destination.searchParams.append(key, value);
  });
  return destination.toString();
}

/** @param {string | undefined} configured */
function explorerOrigin(configured) {
  const candidate = configured?.trim() || STANDALONE_EXPLORER_ORIGIN;
  try {
    const url = new URL(candidate);
    if (url.protocol === 'https:' && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password) {
      return url.origin;
    }
  } catch {
    /* Use the dedicated Explorer host. */
  }
  return STANDALONE_EXPLORER_ORIGIN;
}
