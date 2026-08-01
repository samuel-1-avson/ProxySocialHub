/**
 * Buyer-facing HTTP CONNECT / SOCKS5 endpoint (edge-gateway PORT).
 * Absolute-URI HTTP forward proxy is not supported (501) — see docs/buyer-proxy.md.
 * Must match control-api BuyerProxyConnectInfo / EDGE_GATEWAY_BUYER_PORT (default 8090).
 * Provider tunnels use TUNNEL_PORT (3128) — not this value.
 */
export function getBuyerProxyEndpoint(): string {
    const configured = process.env.NEXT_PUBLIC_PROXY_ENDPOINT?.trim();
    if (configured) {
        return configured;
    }
    const host = process.env.NEXT_PUBLIC_EDGE_GATEWAY_BUYER_HOST?.trim();
    const port = process.env.NEXT_PUBLIC_EDGE_GATEWAY_BUYER_PORT?.trim();
    if (host) {
        return port ? `${host}:${port}` : host;
    }
    if (process.env.NODE_ENV === 'development') {
        return 'localhost:8090';
    }
    return 'proxy.proxyhubb.com:8090';
}
