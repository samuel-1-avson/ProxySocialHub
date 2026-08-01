'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Copy, Download, KeyRound, Terminal } from 'lucide-react';
import {
    buildProviderToml,
    buildStartCommand,
    defaultProviderConfigPath,
    downloadProviderToml,
    getOrCreateProviderSigningKey,
    getProviderEndpoints,
    loadProviderApiKey,
    saveProviderApiKey,
} from '@/lib/provider-config';
import { createProviderToken, getNodeConnectInfo } from '@/lib/api/provider';
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
    const [sessionToken, setSessionToken] = useState<string | null>(null);

    const { data: connectInfo, isLoading, error } = useQuery({
        queryKey: ['node-connect', nodeId],
        queryFn: () => getNodeConnectInfo(nodeId),
        enabled: Boolean(nodeId),
    });

    const tokenMutation = useMutation({
        mutationFn: () => createProviderToken({ name: `node-${nodeId.slice(0, 8)}` }),
        onSuccess: (res) => {
            saveProviderApiKey(res.token);
            setSessionToken(res.token);
        },
    });

    const apiKey = apiKeyProp ?? sessionToken ?? loadProviderApiKey();
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
                    <div className="space-y-2">
                        <p className="text-[10px] font-mono text-amber-200/90">
                            This config needs a provider API token. Create one now — it will be embedded in the
                            downloaded <code className="text-amber-100">provider.toml</code> (shown once).
                        </p>
                        <button
                            type="button"
                            onClick={() => tokenMutation.mutate()}
                            disabled={tokenMutation.isPending}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground font-mono text-[10px] font-bold uppercase disabled:opacity-50"
                        >
                            <KeyRound size={12} />
                            {tokenMutation.isPending ? 'Creating token…' : 'Create connection token'}
                        </button>
                        {tokenMutation.isError && (
                            <p className="text-[10px] font-mono text-red-400">
                                Could not create a token. Try again or use{' '}
                                <Link href="/dashboard/provider/tokens" className="underline text-primary">
                                    API Tokens
                                </Link>
                                .
                            </p>
                        )}
                    </div>
                </div>
            )}

            {providerSigningKey && (
                <div className="flex items-start gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3 py-2">
                    <CheckCircle2 size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                    <p className="text-[10px] font-mono text-emerald-200/90">
                        Includes a device <code className="text-emerald-100">provider_signing_key</code> for
                        heartbeat proofs. The first verified heartbeat binds it to this node — no copy/paste needed.
                    </p>
                </div>
            )}

            <p className="text-[9px] font-mono text-muted-foreground/80">
                After download: run <code className="text-primary">provider-node start</code> only — do not{' '}
                <code className="text-primary">register</code> again for this node.
            </p>

            {apiKey ? (
                <pre className="text-[10px] font-mono text-muted-foreground bg-black/30 rounded-xl px-3 py-3 whitespace-pre-wrap max-h-48 overflow-auto">
                    {toml}
                </pre>
            ) : (
                <p className="text-[10px] font-mono text-muted-foreground/70">
                    The config preview appears after a token is created.
                </p>
            )}

            <div className="flex flex-wrap gap-2">
                <button
                    type="button"
                    disabled={!apiKey}
                    onClick={() => downloadProviderToml(`provider-${nodeId.slice(0, 8)}.toml`, toml)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary text-primary-foreground font-mono text-[10px] font-bold uppercase disabled:opacity-50"
                >
                    <Download size={12} />
                    Download provider.toml
                </button>
                <button
                    type="button"
                    disabled={!apiKey}
                    onClick={() => copy(toml, 'toml')}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/10 font-mono text-[10px] font-bold uppercase disabled:opacity-50"
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
