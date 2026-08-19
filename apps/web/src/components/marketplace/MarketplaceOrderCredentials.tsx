'use client';

import { useState } from 'react';
import { CheckCircle, Copy, Eye, EyeOff } from 'lucide-react';
import type { MarketplaceProxyCredentials } from '@/lib/api/marketplace';
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

    const sessionCapability =
        typed.session_capability ||
        (typeof rec.session_capability === 'string' ? rec.session_capability : undefined);

    return {
        username: String(typed.username ?? ''),
        password: String(typed.password ?? ''),
        endpoint,
        seller_name: typed.seller_name,
        listing_title: typed.listing_title,
        legacy_password: typed.legacy_password,
        auth_for_endpoint: typed.auth_for_endpoint,
        session_capability: sessionCapability,
        session_capability_note: typed.session_capability_note,
    };
}

export function MarketplaceOrderCredentials({
    credentials,
    orderId,
}: {
    credentials: MarketplaceProxyCredentials | Record<string, unknown>;
    orderId?: string;
}) {
    const creds = normalizeCredentials(credentials);
    const [showPass, setShowPass] = useState(false);
    const [showCapability, setShowCapability] = useState(false);
    const [copied, setCopied] = useState<string | null>(null);

    const copyToClipboard = async (value: string, key: string) => {
        await navigator.clipboard.writeText(value);
        setCopied(key);
        setTimeout(() => setCopied(null), 2000);
    };

    const fields: CredentialField[] = [
        { label: 'Endpoint', value: creds.endpoint, key: 'endpoint' },
        { label: 'Username', value: creds.username, key: 'username' },
        { label: 'Password', value: creds.password, key: 'password', secret: true },
    ];

    const curlExample = `curl -x http://${encodeURIComponent(creds.username)}:${encodeURIComponent(creds.password)}@${creds.endpoint} https://httpbin.org/ip`;

    return (
        <div className="space-y-4" data-testid="marketplace-order-credentials">
            <div className="space-y-3 bg-white/5 rounded-2xl p-4 border border-white/10">
                <p className="text-[9px] font-black uppercase tracking-widest text-white/40">Proxy credentials</p>
                <p className="text-[10px] text-white/40">
                    HTTP CONNECT to the endpoint below. Password is HMAC for the public buyer edge
                    ({creds.endpoint || 'proxy.proxyhubb.com:8090'}).
                </p>
                {fields.map(({ label, value, key, secret }) => (
                    <div key={key} className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                            <p className="text-[9px] text-white/30 uppercase tracking-widest">{label}</p>
                            <p className="text-xs font-mono text-white/80 break-all">
                                {secret && !showPass ? '••••••••••••' : value}
                            </p>
                        </div>
                        <div className="flex gap-1 shrink-0">
                            {secret && (
                                <button
                                    type="button"
                                    onClick={() => setShowPass((v) => !v)}
                                    className="p-2 rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition-colors"
                                    aria-label={showPass ? 'Hide password' : 'Show password'}
                                >
                                    {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => copyToClipboard(value, key)}
                                className="p-2 rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition-colors"
                                aria-label={`Copy ${label}`}
                            >
                                {copied === key ? (
                                    <CheckCircle size={14} className="text-green-500" />
                                ) : (
                                    <Copy size={14} />
                                )}
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            <div className="space-y-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-white/40">Quick test</p>
                <p className="text-[10px] text-white/40">
                    Endpoint is HTTP CONNECT / SOCKS5 only (absolute-URI forward proxy returns 501). Chrome and
                    curl use this username + password — not a capability token.
                </p>
                <pre
                    data-testid="marketplace-order-credentials-curl"
                    className="text-[10px] font-mono text-white/70 bg-black/40 border border-white/10 rounded-xl p-3 overflow-x-auto whitespace-pre-wrap break-all"
                >
                    {curlExample}
                </pre>
                <button
                    type="button"
                    onClick={() => copyToClipboard(curlExample, 'curl')}
                    className="text-[10px] font-bold uppercase tracking-widest text-purple-400 hover:text-purple-300"
                >
                    {copied === 'curl' ? 'Copied curl command' : 'Copy curl command'}
                </button>
            </div>

            {creds.session_capability ? (
                <details
                    data-testid="marketplace-order-credentials-advanced"
                    className="rounded-2xl border border-white/10 bg-white/[0.02] p-4"
                >
                    <summary className="cursor-pointer text-[9px] font-black uppercase tracking-widest text-white/40">
                        Advanced: soak capability token
                    </summary>
                    <p className="mt-2 text-[10px] text-white/40">
                        {creds.session_capability_note ||
                            'Not for the public buyer edge. Host-A capability soak (:18091) only.'}
                    </p>
                    <div className="mt-3 flex items-start justify-between gap-2">
                        <p className="min-w-0 break-all font-mono text-[10px] text-white/60">
                            {showCapability ? creds.session_capability : '••••••••••••'}
                        </p>
                        <div className="flex shrink-0 gap-1">
                            <button
                                type="button"
                                onClick={() => setShowCapability((v) => !v)}
                                className="rounded-lg p-2 text-white/40 hover:bg-white/10 hover:text-white"
                                aria-label={showCapability ? 'Hide capability token' : 'Show capability token'}
                            >
                                {showCapability ? <EyeOff size={14} /> : <Eye size={14} />}
                            </button>
                            <button
                                type="button"
                                onClick={() => copyToClipboard(creds.session_capability ?? '', 'capability')}
                                className="rounded-lg p-2 text-white/40 hover:bg-white/10 hover:text-white"
                                aria-label="Copy capability token"
                            >
                                {copied === 'capability' ? (
                                    <CheckCircle size={14} className="text-green-500" />
                                ) : (
                                    <Copy size={14} />
                                )}
                            </button>
                        </div>
                    </div>
                </details>
            ) : null}

            {orderId && (
                <p className="text-[10px] text-white/30">
                    Order <span className="font-mono text-white/50">{orderId}</span> — traffic routes through the edge
                    gateway using the credentials above.
                </p>
            )}
        </div>
    );
}
