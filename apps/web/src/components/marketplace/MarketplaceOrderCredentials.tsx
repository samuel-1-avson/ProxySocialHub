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
    const endpoint =
        (raw as MarketplaceProxyCredentials).endpoint ||
        (typeof (raw as Record<string, unknown>).host === 'string' &&
        typeof (raw as Record<string, unknown>).port === 'number'
            ? `${(raw as Record<string, unknown>).host}:${(raw as Record<string, unknown>).port}`
            : getBuyerProxyEndpoint());

    return {
        username: String((raw as MarketplaceProxyCredentials).username ?? ''),
        password: String((raw as MarketplaceProxyCredentials).password ?? ''),
        endpoint,
        seller_name: (raw as MarketplaceProxyCredentials).seller_name,
        listing_title: (raw as MarketplaceProxyCredentials).listing_title,
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
                <pre className="text-[10px] font-mono text-white/70 bg-black/40 border border-white/10 rounded-xl p-3 overflow-x-auto whitespace-pre-wrap break-all">
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

            {orderId && (
                <p className="text-[10px] text-white/30">
                    Order <span className="font-mono text-white/50">{orderId}</span> — traffic routes through the edge
                    gateway using the credentials above.
                </p>
            )}
        </div>
    );
}
