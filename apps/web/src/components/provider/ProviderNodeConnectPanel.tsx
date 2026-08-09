'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Copy, Download, Loader2, Terminal } from 'lucide-react';
import {
    buildJoinCommand,
    buildProviderToml,
    buildStartCommand,
    buildUnixInstallScript,
    buildWindowsInstallScript,
    defaultProviderConfigPath,
    downloadProviderConfig,
    downloadProviderToml,
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
    const autoMintStarted = useRef(false);

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
        (isWindowsClient()
            ? connectInfo?.config_path_windows
            : connectInfo?.config_path_unix) ??
        connectInfo?.config_path_hint ??
        defaultProviderConfigPath();
    const startCmd = connectInfo?.start_command ?? buildStartCommand(configPath);
    const joinCmd = apiKey ? buildJoinCommand(apiKey, nodeId, endpoints.controlApiUrl) : '';
    const installScript = isWindowsClient()
        ? buildWindowsInstallScript(toml)
        : buildUnixInstallScript(toml);
    const installLabel = isWindowsClient()
        ? 'Copy install script (Windows)'
        : 'Copy install script (macOS/Linux)';

    function copy(text: string, key: string) {
        navigator.clipboard.writeText(text);
        setCopied(key);
        setTimeout(() => setCopied(null), 2000);
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
                    <p className="text-[10px] font-mono text-muted-foreground mt-1">
                        We mint a token and embed it in config. The CLI reads{' '}
                        <code className="text-primary/80">{configPath}</code> — not your Downloads folder.
                        Paste the install script (or run the Windows apply <code className="text-primary/80">.ps1</code>
                        ), then restart. Do not only download <code className="text-primary/80">provider.toml</code>.
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
                <div className="flex items-start gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3 py-2">
                    <CheckCircle2 size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                    <p className="text-[10px] font-mono text-emerald-200/90">
                        Token ready for gateway{' '}
                        <code className="text-emerald-100">{endpoints.gatewayTunnelAddr}</code>.
                        Required next step: paste the install script (or run the downloaded{' '}
                        <code className="text-emerald-100">Apply-ProxyHubb-Provider.ps1</code>) so{' '}
                        <code className="text-emerald-100">{configPath}</code> gets the new{' '}
                        <code className="text-emerald-100">api_key</code>. A file sitting in Downloads is{' '}
                        <strong className="text-emerald-100">not</strong> used by{' '}
                        <code className="text-emerald-100">provider-node</code>. Then{' '}
                        <code className="text-emerald-100">provider-node stop</code> and{' '}
                        <code className="text-emerald-100">provider-node start</code>.
                    </p>
                </div>
            )}

            {ready && (
                <pre className="text-[10px] font-mono text-muted-foreground bg-black/30 rounded-xl px-3 py-3 whitespace-pre-wrap max-h-40 overflow-auto">
                    {toml}
                </pre>
            )}

            <div className="flex flex-wrap gap-2">
                <button
                    type="button"
                    disabled={!ready}
                    onClick={() => copy(installScript, 'install')}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary text-primary-foreground font-mono text-[10px] font-bold uppercase disabled:opacity-50"
                >
                    {copied === 'install' ? (
                        <CheckCircle2 size={12} className="text-emerald-200" />
                    ) : (
                        <Terminal size={12} />
                    )}
                    {installLabel}
                </button>
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
                    onClick={() => {
                        const kind = downloadProviderConfig(toml);
                        if (kind === 'ps1') {
                            copy(installScript, 'download');
                        } else {
                            setCopied('download');
                            setTimeout(() => setCopied(null), 2000);
                        }
                    }}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/10 font-mono text-[10px] font-bold uppercase disabled:opacity-50"
                >
                    {copied === 'download' ? (
                        <CheckCircle2 size={12} className="text-emerald-400" />
                    ) : (
                        <Download size={12} />
                    )}
                    {isWindowsClient()
                        ? 'Download apply script (.ps1)'
                        : 'Download provider.toml'}
                </button>
                {isWindowsClient() ? (
                    <button
                        type="button"
                        disabled={!ready}
                        onClick={() => downloadProviderToml('provider.toml', toml)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 font-mono text-[10px] font-bold uppercase disabled:opacity-50"
                    >
                        <Download size={12} />
                        Raw provider.toml
                    </button>
                ) : null}
                <button
                    type="button"
                    onClick={() => copy(startCmd, 'start')}
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

            <ol className="text-[9px] font-mono text-muted-foreground/80 space-y-1 list-decimal list-inside">
                <li>Install the CLI from Dashboard → CLI &amp; Tools (once).</li>
                <li>
                    Paste the <strong className="text-foreground/80">install script</strong> in PowerShell, or run
                    the downloaded <code className="text-primary">Apply-ProxyHubb-Provider.ps1</code> — this writes{' '}
                    <code className="text-primary">{configPath}</code>. A raw TOML in Downloads is ignored until
                    you copy it there.
                </li>
                <li>
                    Run <code className="text-primary">{startCmd}</code> — do not edit files or run{' '}
                    <code className="text-primary">register</code> again.
                </li>
            </ol>
        </div>
    );
}
