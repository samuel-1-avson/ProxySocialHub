'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Copy, Download, Terminal } from 'lucide-react';
import {
    buildProviderToml,
    buildStartCommand,
    defaultProviderConfigPath,
    downloadProviderToml,
    getOrCreateProviderSigningKey,
    getProviderEndpoints,
    loadProviderApiKey,
} from '@/lib/provider-config';
import { getNodeConnectInfo } from '@/lib/api/provider';
import Link from 'next/link';

interface ProviderNodeConnectPanelProps {
    nodeId: string;
    nodeName?: string;
    /** Fresh API key from token creation (wizard / tokens page). */
    apiKey?: string | null;
    compact?: boolean;
}

export function ProviderNodeConnectPanel({
    nodeId,
    nodeName,
    apiKey: apiKeyProp,
    compact = false,
}: ProviderNodeConnectPanelProps) {
    const [copied, setCopied] = useState<string | null>(null);

    const { data: connectInfo, isLoading, error } = useQuery({
        queryKey: ['node-connect', nodeId],
        queryFn: () => getNodeConnectInfo(nodeId),
        enabled: Boolean(nodeId),
    });

    const apiKey = apiKeyProp ?? loadProviderApiKey();
    const providerSigningKey = useMemo(() => getOrCreateProviderSigningKey(), []);
    const endpoints = useMemo(() => {
        if (connectInfo) {
            return {
                controlApiUrl: connectInfo.control_api_url,
                gatewayTunnelAddr: connectInfo.gateway_tunnel_addr,
                useTls: connectInfo.use_tls,
            };
        }
        return getProviderEndpoints();
    }, [connectInfo]);

    const toml = buildProviderToml({
        nodeId,
        apiKey,
        providerSigningKey,
        connectionType: connectInfo?.connection_type,
        endpoints,
    });

    const configPath = connectInfo?.config_path_hint ?? defaultProviderConfigPath();
    const startCmd = connectInfo?.start_command ?? buildStartCommand(configPath);

    function copy(text: string, key: string) {
        navigator.clipboard.writeText(text);
        setCopied(key);
        setTimeout(() => setCopied(null), 2000);
    }

    const title = nodeName ? `Connect "${nodeName}"` : 'Connect this node';

    return (
        <div className={`space-y-3 ${compact ? '' : 'rounded-2xl border border-white/10 bg-black/20 p-4'}`}>
            {!compact && (
                <div>
                    <p className="text-xs font-bold font-mono uppercase tracking-wider text-primary">
                        Run on your machine
                    </p>
                    <p className="text-[10px] font-mono text-muted-foreground mt-1">
                        Save the config outside this repo (home directory or any server). No edits to{' '}
                        <code className="text-primary/80">cli/provider.toml</code> in git.
                    </p>
                </div>
            )}

            {isLoading && (
                <p className="text-[10px] font-mono text-muted-foreground">Loading connection settings…</p>
            )}
            {error && (
                <p className="text-[10px] font-mono text-red-400 flex items-center gap-1">
                    <AlertCircle size={12} />
                    Could not load server endpoints.
                </p>
            )}

            {!apiKey && (
                <div className="flex items-start gap-2 rounded-xl bg-amber-500/10 border border-amber-500/20 px-3 py-2">
                    <AlertCircle size={14} className="text-amber-400 shrink-0 mt-0.5" />
                    <p className="text-[10px] font-mono text-amber-200/90">
                        Create an API token first so the downloaded config includes{' '}
                        <code className="text-amber-100">api_key</code>.{' '}
                        <Link href="/dashboard/provider/tokens" className="underline text-primary">
                            API Tokens
                        </Link>
                        {' '}or rerun the setup wizard token step.
                    </p>
                </div>
            )}

            {providerSigningKey && (
                <div className="flex items-start gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3 py-2">
                    <CheckCircle2 size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                    <p className="text-[10px] font-mono text-emerald-200/90">
                        Includes <code className="text-emerald-100">provider_signing_key</code> for heartbeat proofs.
                        If your profile Solana wallet is linked, prefer signing with that wallet as the hotkey
                        (random browser keys will not bind when a linked wallet is required).
                        Payout wallet is separate and copied from your linked profile wallet automatically.
                    </p>
                </div>
            )}

            <p className="text-[9px] font-mono text-muted-foreground/80">
                After download: run <code className="text-primary">provider-node start</code> only — do not{' '}
                <code className="text-primary">register</code> again for this node.
            </p>

            <pre className="text-[10px] font-mono text-muted-foreground bg-black/30 rounded-xl px-3 py-3 whitespace-pre-wrap max-h-48 overflow-auto">
                {toml}
            </pre>

            <div className="flex flex-wrap gap-2">
                <button
                    type="button"
                    onClick={() => downloadProviderToml(`provider-${nodeId.slice(0, 8)}.toml`, toml)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary text-primary-foreground font-mono text-[10px] font-bold uppercase"
                >
                    <Download size={12} />
                    Download provider.toml
                </button>
                <button
                    type="button"
                    onClick={() => copy(toml, 'toml')}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/10 font-mono text-[10px] font-bold uppercase"
                >
                    {copied === 'toml' ? <CheckCircle2 size={12} className="text-emerald-400" /> : <Copy size={12} />}
                    Copy config
                </button>
                <button
                    type="button"
                    onClick={() => copy(startCmd, 'start')}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/10 font-mono text-[10px] font-bold uppercase"
                >
                    {copied === 'start' ? <CheckCircle2 size={12} className="text-emerald-400" /> : <Terminal size={12} />}
                    Copy start command
                </button>
            </div>

            <p className="text-[9px] font-mono text-muted-foreground/70">
                Save to <code className="text-muted-foreground">{configPath}</code>, then:{' '}
                <code className="text-primary/80">{startCmd}</code>
            </p>
        </div>
    );
}
