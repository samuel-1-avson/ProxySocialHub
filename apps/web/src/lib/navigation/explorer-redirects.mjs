/**
 * Redirect only public record routes after the independent Explorer is enabled.
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
  return aliases.map(([source, target]) => ({
    source,
    destination: `${url.origin}${target}`,
    // Temporary while validating the independent production service.
    permanent: false,
  }));
}
