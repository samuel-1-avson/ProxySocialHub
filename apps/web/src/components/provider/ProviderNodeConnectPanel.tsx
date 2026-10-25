'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
    AlertCircle,
    CheckCircle2,
    ChevronDown,
    ChevronRight,
    Copy,
    Download,
    Loader2,
    MonitorPlay,
    Terminal,
} from 'lucide-react';
import {
    buildJoinCommand,
    buildProviderToml,
    buildUnixSetupThisPcScript,
    buildWindowsSetupThisPcScript,
    defaultProviderConfigPath,
    downloadProviderToml,
    downloadSetupThisPc,
    getOrCreateProviderSigningKey,
    getProviderEndpoints,
    isWindowsClient,
    loadProviderApiKey,
    sanitizeProviderEndpoints,
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
    const [showAdvanced, setShowAdvanced] = useState(false);
    const autoMintStarted = useRef(false);
    const windows = isWindowsClient();

    const { data: connectInfo, isLoading, error } = useQuery({
        queryKey: ['node-connect', nodeId],
        queryFn: () => getNodeConnectInfo(nodeId),
        enabled: Boolean(nodeId),
    });

    const tokenMutation = useMutation({
        mutationFn: () =>
            createProviderToken({
                name: `node-${nodeId.slice(0, 8)}`,
                node_id: nodeId,
            }),
        onSuccess: (res) => {
            saveProviderApiKey(res.token, nodeId);
            setSessionToken(res.token);
        },
    });

    const apiKey = apiKeyProp ?? sessionToken ?? loadProviderApiKey(nodeId);

    // Auto-mint a node-bound token so users never hand-edit api_key.
    useEffect(() => {
        if (!nodeId || apiKey || autoMintStarted.current) return;
        if (tokenMutation.isPending || tokenMutation.isSuccess || tokenMutation.isError) return;
        autoMintStarted.current = true;
        tokenMutation.mutate();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- mint once per mount when missing
    }, [nodeId, apiKey]);

    const providerSigningKey = useMemo(
        () => getOrCreateProviderSigningKey(nodeId),
        [nodeId],
    );
    const endpoints = useMemo(() => {
        if (connectInfo) {
            return sanitizeProviderEndpoints({
                controlApiUrl: connectInfo.control_api_url,
                gatewayTunnelAddr: connectInfo.gateway_tunnel_addr,
                gatewayTunnelAddrs: connectInfo.gateway_tunnel_addrs ?? [],
                useTls: connectInfo.use_tls,
                tlsSkipVerify: connectInfo.tls_skip_verify ?? false,
            });
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

    const configPath =
        (windows
            ? connectInfo?.config_path_windows
            : connectInfo?.config_path_unix) ??
        connectInfo?.config_path_hint ??
        defaultProviderConfigPath();
    const joinCmd = apiKey ? buildJoinCommand(apiKey, nodeId, endpoints.controlApiUrl) : '';
    const setupScript = windows
        ? buildWindowsSetupThisPcScript(toml, endpoints.controlApiUrl)
        : buildUnixSetupThisPcScript(toml, endpoints.controlApiUrl);

    function copy(text: string, key: string) {
        navigator.clipboard.writeText(text);
        setCopied(key);
        setTimeout(() => setCopied(null), 2500);
    }

    const title = nodeName ? `Connect "${nodeName}"` : 'Connect this node';
    const ready = Boolean(apiKey);

    return (
        <div className={`space-y-3 ${compact ? '' : 'rounded-2xl border border-white/10 bg-black/20 p-4'}`}>
            {!compact && (
                <div>
                    <p className="text-xs font-bold font-mono uppercase tracking-wider text-primary">
                        {title}
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">
                        One step: run <strong className="text-foreground">Setup this PC</strong>. It saves your
                        config in the right place, installs the app if needed, and starts your node.
                    </p>
                </div>
            )}

            {isLoading && (
                <p className="text-[10px] font-mono text-muted-foreground">Loading connection settings…</p>
            )}
            {error && (
                <p className="text-[10px] font-mono text-red-400 flex items-center gap-1">
                    <AlertCircle size={12} />
                    Could not load server endpoints — using production defaults.
                </p>
            )}

            {!ready && (tokenMutation.isPending || autoMintStarted.current) && (
                <div className="flex items-center gap-2 rounded-xl bg-primary/10 border border-primary/20 px-3 py-2">
                    <Loader2 size={14} className="text-primary animate-spin shrink-0" />
                    <p className="text-[10px] font-mono text-primary/90">
                        Creating a connection token for this node…
                    </p>
                </div>
            )}

            {tokenMutation.isError && !ready && (
                <div className="flex items-start gap-2 rounded-xl bg-red-500/10 border border-red-500/20 px-3 py-2">
                    <AlertCircle size={14} className="text-red-400 shrink-0 mt-0.5" />
                    <div className="space-y-2">
                        <p className="text-[10px] font-mono text-red-200/90">
                            Could not auto-create a token. Retry or use{' '}
                            <Link href="/dashboard/provider/tokens" className="underline text-primary">
                                API Tokens
                            </Link>
                            .
                        </p>
                        <button
                            type="button"
                            onClick={() => {
                                autoMintStarted.current = true;
                                tokenMutation.mutate();
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground font-mono text-[10px] font-bold uppercase"
                        >
                            Retry token create
                        </button>
                    </div>
                </div>
            )}

            {ready && (
                <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 space-y-3">
                    <div className="flex items-start gap-2">
                        <CheckCircle2 size={18} className="text-emerald-400 shrink-0 mt-0.5" />
                        <div>
                            <p className="text-sm font-semibold text-emerald-100">Ready to connect this computer</p>
                            <p className="text-xs text-emerald-200/80 mt-1">
                                Do <strong>not</strong> only download a TOML file — the app does not read your
                                Downloads folder. Use Setup this PC below.
                            </p>
                        </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2">
                        <button
                            type="button"
                            disabled={!ready}
                            onClick={() => {
                                downloadSetupThisPc(toml, endpoints.controlApiUrl);
                                copy(setupScript, 'setup');
                            }}
                            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm disabled:opacity-50"
                        >
                            {copied === 'setup' ? (
                                <CheckCircle2 size={16} />
                            ) : (
                                <MonitorPlay size={16} />
                            )}
                            {windows
                                ? '1. Download Setup this PC (.cmd)'
                                : '1. Download setup script'}
                        </button>
                        <button
                            type="button"
                            disabled={!ready}
                            onClick={() => copy(setupScript, 'setup-copy')}
                            className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-white/10 text-sm font-medium disabled:opacity-50"
                        >
                            {copied === 'setup-copy' ? (
                                <CheckCircle2 size={16} className="text-emerald-400" />
                            ) : (
                                <Copy size={16} />
                            )}
                            Or copy script
                        </button>
                    </div>

                    <ol className="text-xs text-emerald-100/90 space-y-1.5 list-decimal list-inside">
                        {windows ? (
                            <>
                                <li>
                                    Open your <strong>Downloads</strong> folder and double-click{' '}
                                    <code className="bg-black/30 px-1 rounded">Setup-ProxyHubb-Provider.cmd</code>
                                </li>
                                <li>If Windows asks, choose <strong>More info → Run anyway</strong></li>
                                <li>Wait until it says Done, then refresh this page — status should become ONLINE</li>
                            </>
                        ) : (
                            <>
                                <li>
                                    In Terminal: <code className="bg-black/30 px-1 rounded">bash ~/Downloads/setup-proxyhubb-provider.sh</code>
                                    {' '}(or paste the copied script)
                                </li>
                                <li>Refresh this page — status should become ONLINE</li>
                            </>
                        )}
                    </ol>
                </div>
            )}

            <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground"
            >
                {showAdvanced ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                Advanced / troubleshooting
            </button>

            {showAdvanced && (
                <div className="space-y-3 rounded-xl border border-white/10 bg-black/20 p-3">
                    <p className="text-[10px] font-mono text-muted-foreground">
                        Config path the app reads: <code className="text-primary/80">{configPath}</code>
                    </p>

                    {ready && (
                        <pre className="text-[10px] font-mono text-muted-foreground bg-black/30 rounded-xl px-3 py-3 whitespace-pre-wrap max-h-40 overflow-auto">
                            {toml}
                        </pre>
                    )}

                    <div className="flex flex-wrap gap-2">
                        {joinCmd ? (
                            <button
                                type="button"
                                onClick={() => copy(joinCmd, 'join')}
                                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/10 font-mono text-[10px] font-bold uppercase"
                            >
                                {copied === 'join' ? (
                                    <CheckCircle2 size={12} className="text-emerald-400" />
                                ) : (
                                    <Copy size={12} />
                                )}
                                Copy join command
                            </button>
                        ) : null}
                        <button
                            type="button"
                            disabled={!ready}
                            onClick={() => downloadProviderToml('provider.toml', toml)}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 font-mono text-[10px] font-bold uppercase disabled:opacity-50"
                        >
                            <Download size={12} />
                            Raw provider.toml
                        </button>
                        <button
                            type="button"
                            onClick={() => copy('provider-node start', 'start')}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/10 font-mono text-[10px] font-bold uppercase"
                        >
                            {copied === 'start' ? (
                                <CheckCircle2 size={12} className="text-emerald-400" />
                            ) : (
                                <Terminal size={12} />
                            )}
                            Copy start command
                        </button>
                    </div>

                    <p className="text-[9px] font-mono text-muted-foreground/80">
                        Tip: if you already downloaded <code className="text-primary">provider.toml</code>, import it
                        with <code className="text-primary">provider-node config install --from &lt;path&gt;</code> —
                        it shows where the file sends traffic and asks before writing {configPath}.
                    </p>
                </div>
            )}
        </div>
    );
}
