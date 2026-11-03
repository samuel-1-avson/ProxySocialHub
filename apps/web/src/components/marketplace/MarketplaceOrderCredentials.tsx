'use client';

import { useEffect, useState } from 'react';
import { CheckCircle, Copy, Eye, EyeOff } from 'lucide-react';
import type { MarketplaceProxyCredentials } from '@/lib/api/marketplace';
import { detectBrowser } from '@/lib/extension';
import { getBuyerProxyEndpoint } from '@/lib/proxy-endpoint';

type CredentialField = {
    label: string;
    value: string;
    key: string;
    secret?: boolean;
};

function normalizeCredentials(
    raw: MarketplaceProxyCredentials | Record<string, unknown>,
): MarketplaceProxyCredentials {
    const rec = raw as Record<string, unknown>;
    const typed = raw as MarketplaceProxyCredentials;
    const endpoint =
        typed.endpoint ||
        (typeof rec.host === 'string' && typeof rec.port === 'number'
            ? `${rec.host}:${rec.port}`
            : getBuyerProxyEndpoint());

    return {
        username: String(typed.username ?? ''),
        password: String(typed.password ?? ''),
        endpoint,
        seller_name: typed.seller_name,
        listing_title: typed.listing_title,
        legacy_password: typed.legacy_password,
        auth_for_endpoint: typed.auth_for_endpoint,
    };
}

/** Settings screens ask for the server and the port separately. */
function splitEndpoint(endpoint: string): { host: string; port: string } {
    const at = endpoint.lastIndexOf(':');
    if (at <= 0) {
        return { host: endpoint, port: '' };
    }
    return { host: endpoint.slice(0, at), port: endpoint.slice(at + 1) };
}

function setupGuides(host: string, port: string): Array<{ key: string; title: string; steps: string[] }> {
    return [
        {
            key: 'firefox',
            title: 'Firefox',
            steps: [
                'Open Settings and search for "proxy", then click Settings…',
                `Choose Manual proxy configuration. HTTP Proxy: ${host}, Port: ${port}.`,
                'Tick "Also use this proxy for HTTPS" and click OK.',
                'Firefox asks for the username and password on the first site you open.',
            ],
        },
        {
            key: 'windows',
            title: 'Windows',
            steps: [
                'Open Settings, then Network & internet, then Proxy.',
                `Next to Manual proxy setup, click Set up. Turn it on, enter ${host} and port ${port}, then Save.`,
                'Your browser asks for the username and password the first time.',
            ],
        },
        {
            key: 'mac',
            title: 'Mac',
            steps: [
                'Open System Settings, then Network, pick your connection, then Details, then Proxies.',
                `Turn on Web proxy (HTTP) and Secure web proxy (HTTPS). Server: ${host}, port: ${port}.`,
                'Turn on "Proxy server requires password", enter the username and password, then OK.',
            ],
        },
        {
            key: 'iphone',
            title: 'iPhone or iPad',
            steps: [
                'Open Settings, then Wi-Fi, and tap the (i) next to your network.',
                `Tap Configure Proxy, then Manual. Server: ${host}, Port: ${port}.`,
                'Turn on Authentication, enter the username and password, then Save. This only applies on that Wi-Fi.',
            ],
        },
        {
            key: 'android',
            title: 'Android',
            steps: [
                'Open Settings, then Wi-Fi, and open your network’s settings (gear icon).',
                `Under Proxy choose Manual. Hostname: ${host}, Port: ${port}, then Save.`,
                'Your browser asks for the username and password the first time. This only applies on that Wi-Fi.',
            ],
        },
        {
            key: 'ai-agent',
            title: 'AI agent (Claude, Cursor, VS Code)',
            steps: [
                'You do not need to copy these details: the ProxyHubb MCP server uses this order for your agent.',
                'Follow docs.proxyhubb.com/docs/agents/mcp to install it and connect Claude Desktop, Claude Code, Cursor or VS Code.',
                'Then ask your agent, for example: "Use ProxyHubb to fetch https://example.com as seen from this order\'s country."',
                'The agent only spends this order’s bandwidth, and only trusts the exit once it is verified.',
            ],
        },
    ];
}

export function MarketplaceOrderCredentials({
    credentials,
}: {
    credentials: MarketplaceProxyCredentials | Record<string, unknown>;
    orderId?: string;
}) {
    const creds = normalizeCredentials(credentials);
    const { host, port } = splitEndpoint(creds.endpoint);
    const [open, setOpen] = useState(false);
    const [showPass, setShowPass] = useState(false);
    const [copied, setCopied] = useState<string | null>(null);

    // Browsers the extension can't run in rely on these details, so show them open.
    useEffect(() => {
        const browser = detectBrowser();
        if (browser === 'safari' || browser === 'other') {
            queueMicrotask(() => setOpen(true));
        }
    }, []);

    const copyToClipboard = async (value: string, key: string) => {
        await navigator.clipboard.writeText(value);
        setCopied(key);
        setTimeout(() => setCopied(null), 2000);
    };

    const fields: CredentialField[] = [
        { label: 'Server', value: host, key: 'host' },
        { label: 'Port', value: port, key: 'port' },
        { label: 'Username', value: creds.username, key: 'username' },
        { label: 'Password', value: creds.password, key: 'password', secret: true },
    ];

    const curlExample = `curl -x http://${encodeURIComponent(creds.username)}:${encodeURIComponent(creds.password)}@${creds.endpoint} https://httpbin.org/ip`;

    return (
        <details
            open={open}
            onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
            className="rounded-lg border border-border bg-secondary p-4"
            data-testid="marketplace-order-credentials"
        >
            <summary className="cursor-pointer text-sm font-semibold text-foreground">
                Use in another app or device
            </summary>
            <div className="mt-3 space-y-4">
                <p className="text-xs text-muted-foreground">
                    Enter these in any app or device that supports an HTTP proxy. Works with sites that start with https://.
                </p>
                <div className="space-y-3">
                    {fields.map(({ label, value, key, secret }) => (
                        <div key={key} className="flex items-center justify-between gap-2">
                            <div className="min-w-0 flex-1">
                                <p className="text-xs text-muted-foreground">{label}</p>
                                <p className="break-all font-mono text-xs text-foreground">
                                    {secret && !showPass ? '••••••••••••' : value}
                                </p>
                            </div>
                            <div className="flex shrink-0 gap-1">
                                {secret && (
                                    <button
                                        type="button"
                                        onClick={() => setShowPass((v) => !v)}
                                        className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                                        aria-label={showPass ? 'Hide password' : 'Show password'}
                                    >
                                        {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => copyToClipboard(value, key)}
                                    className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                                    aria-label={`Copy ${label}`}
                                >
                                    {copied === key ? <CheckCircle size={14} className="text-success" /> : <Copy size={14} />}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">How to set it up</p>
                    {setupGuides(host, port).map((guide) => (
                        <details key={guide.key} className="rounded-md border border-border bg-background px-3 py-2">
                            <summary className="cursor-pointer text-xs font-medium text-foreground">{guide.title}</summary>
                            <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
                                {guide.steps.map((step) => (
                                    <li key={step}>{step}</li>
                                ))}
                            </ol>
                        </details>
                    ))}
                </div>

                <details className="rounded-md border border-border bg-background px-3 py-2">
                    <summary className="cursor-pointer text-xs font-medium text-foreground">For developers</summary>
                    <pre
                        data-testid="marketplace-order-credentials-curl"
                        className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-border bg-secondary p-3 font-mono text-xs text-foreground"
                    >
                        {curlExample}
                    </pre>
                    <button
                        type="button"
                        onClick={() => copyToClipboard(curlExample, 'curl')}
                        className="mt-2 text-xs font-medium text-primary"
                    >
                        {copied === 'curl' ? 'Copied' : 'Copy command'}
                    </button>
                </details>
            </div>
        </details>
    );
}
