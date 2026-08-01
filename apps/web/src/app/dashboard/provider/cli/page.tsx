'use client';

import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/glass-card';
import {
    FileCode, Download, Copy, CheckCircle2, Terminal, Monitor,
    Apple, Server, Loader2, AlertCircle, ExternalLink, Link2, Github, Activity
} from 'lucide-react';
import Link from 'next/link';
import {
    getCLIDownloads,
    getCLIDownloadUrl,
    getProviderCliReleasesUrl,
    detectPlatform,
    type CLIDownload,
} from '@/lib/api/provider';
import { getProviderNodes } from '@/lib/api/marketplace';
import {
    defaultProviderConfigPath,
    getProviderEndpoints,
} from '@/lib/provider-config';
import { useToast } from '@/stores';

const PLATFORMS = [
    { id: 'linux', label: 'Linux', icon: Terminal, archs: ['amd64', 'arm64'] },
    { id: 'windows', label: 'Windows', icon: Monitor, archs: ['amd64'] },
    { id: 'macos', label: 'macOS', icon: Apple, archs: ['amd64', 'arm64'] },
];

function resolveDownload(
    downloads: Record<string, CLIDownload> | undefined,
    platform: string,
    arch: string,
): CLIDownload | undefined {
    if (!downloads) return undefined;
    const keys = [
        `${platform}_${arch}_bundle`,
        `${platform}_${arch}`,
        `${platform}-${arch}`,
        `${platform}_${arch}_daemon`,
    ];
    for (const key of keys) {
        if (downloads[key]) return downloads[key];
    }
    return Object.values(downloads).find(
        (d) => d.platform === platform && d.arch === arch && (d.package_type === 'daemon' || d.package_type === 'bundle' || !d.package_type),
    );
}

function platformHasBuild(
    downloads: Record<string, CLIDownload> | undefined,
    platform: string,
    arch: string,
): boolean {
    return Boolean(resolveDownload(downloads, platform, arch));
}

/** Normalize checksum for display/copy (strip sha256: prefix; keep full 64-hex when present). */
function formatChecksum(raw: string | undefined): string {
    if (!raw) return '';
    const trimmed = raw.trim();
    const withoutPrefix = trimmed.replace(/^sha256:/i, '').trim();
    return withoutPrefix || trimmed;
}

/** Shell-safe --config flag for the selected OS (PowerShell on Windows). */
function configFlag(platform: string): string {
    if (platform === 'windows') {
        return '--config "$env:USERPROFILE\\.proxyhubb\\provider.toml"';
    }
    return '--config ~/.proxyhubb/provider.toml';
}

export default function CLIPage() {
    const toast = useToast();
    const [selectedPlatform, setSelectedPlatform] = useState('linux');
    const [selectedArch, setSelectedArch] = useState('amd64');
    const [copied, setCopied] = useState<string | null>(null);
    const [downloadStarted, setDownloadStarted] = useState(false);
    const endpoints = useMemo(() => getProviderEndpoints(), []);
    const configPath = useMemo(() => defaultProviderConfigPath(), []);
    const releasesUrl = useMemo(() => getProviderCliReleasesUrl(), []);
    const exe = selectedPlatform === 'windows' ? 'provider-node.exe' : 'provider-node';
    const cfg = configFlag(selectedPlatform);

    const { data, isLoading, error } = useQuery({
        queryKey: ['cli-downloads'],
        queryFn: getCLIDownloads,
        staleTime: 5 * 60_000,
    });

    const {
        data: nodesData,
        isLoading: nodesLoading,
        refetch: refetchNodes,
        dataUpdatedAt,
    } = useQuery({
        queryKey: ['provider-nodes-cli-console'],
        queryFn: getProviderNodes,
        refetchInterval: downloadStarted ? 15_000 : 60_000,
        staleTime: 10_000,
        retry: 1,
    });

    useEffect(() => {
        const { platform, arch } = detectPlatform();
        setSelectedPlatform(platform);
        setSelectedArch(arch);
    }, []);

    useEffect(() => {
        if (!data?.downloads) return;
        if (platformHasBuild(data.downloads, selectedPlatform, selectedArch)) return;
        for (const p of PLATFORMS) {
            for (const a of p.archs) {
                if (platformHasBuild(data.downloads, p.id, a)) {
                    setSelectedPlatform(p.id);
                    setSelectedArch(a);
                    return;
                }
            }
        }
    }, [data, selectedPlatform, selectedArch]);

    const version = data?.latest_version ?? '…';
    const platformConfig = PLATFORMS.find((p) => p.id === selectedPlatform) ?? PLATFORMS[0];
    const downloadInfo = resolveDownload(data?.downloads, selectedPlatform, selectedArch);
    const packageType = downloadInfo?.package_type ?? 'daemon';
    const binaryHint = downloadInfo?.filename ?? (selectedPlatform === 'windows' ? 'provider-node.exe' : 'provider-node');
    const nodes = nodesData?.nodes ?? [];
    const onlineCount = nodes.filter((n) => /online|active|healthy/i.test(n.status)).length;

    function copy(text: string, key: string) {
        navigator.clipboard.writeText(text);
        setCopied(key);
        setTimeout(() => setCopied(null), 2000);
    }

    function handleDownloadClick() {
        if (!downloadInfo) return;
        setDownloadStarted(true);
        toast.success(
            'Download started',
            selectedPlatform === 'windows'
                ? 'Open the .exe (or Launch-Provider-Console.cmd from a GitHub Release zip) — a console window stays open with the interactive menu.'
                : 'Run the binary in a terminal with no arguments to open the interactive Provider console.',
        );
        requestAnimationFrame(() => {
            document.getElementById('cli-next-steps')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    }

    const checksum = formatChecksum(downloadInfo?.checksum);
    const verifyChecksumCmd = selectedPlatform === 'windows'
        ? (checksum
            ? `# PowerShell — verify download\nGet-FileHash .\\${binaryHint} -Algorithm SHA256\n# expect: ${checksum}`
            : `# PowerShell — verify download\nGet-FileHash .\\${binaryHint} -Algorithm SHA256`)
        : (checksum
            ? `# verify download\nshasum -a 256 ./${binaryHint}\n# expect: ${checksum}`
            : `# verify download\nshasum -a 256 ./${binaryHint}`);

    const openConsoleCmd = selectedPlatform === 'windows'
        ? `# After download (browser Downloads folder):\n# Option A — double-click the .exe (interactive console)\n# Option B — from a Release zip, double-click Launch-Provider-Console.cmd\n\ncd $env:USERPROFILE\\Downloads\n.\\${binaryHint}\n\n# Put provider.toml at:\n#   ${configPath}\n# Prefer: Setup wizard / My nodes → Connect (do not register again)`
        : `# After download:\nchmod +x ./${binaryHint}\n# Optional install onto PATH:\n# sudo mv ./${binaryHint} /usr/local/bin/provider-node\n\n./${binaryHint}\n\n# Config path: ${configPath}\n# Prefer: Setup wizard / My nodes → Connect (do not register again)`;

    const installCmd = selectedPlatform === 'windows'
        ? `# Recommended — after Setup / My nodes → Connect saved provider.toml\n# Do NOT run register again (creates a second orphan node).\n${exe} doctor ${cfg}\n${exe} start ${cfg}\n\n# Optional — run as a Windows service instead of foreground start:\n# ${exe} service install ${cfg}\n# ${exe} service start\n# ${exe} service status`
        : `# Recommended — after Setup / My nodes → Connect saved provider.toml\n# Do NOT run register again (creates a second orphan node).\nchmod +x ./${binaryHint}\n./${binaryHint} doctor ${cfg}\n./${binaryHint} start ${cfg}\n\n# Optional — systemd/launchd service instead of foreground start:\n# provider-node service install ${cfg}\n# provider-node service start`;

    const registerOnlyCmd = `${exe} register --api-url ${endpoints.controlApiUrl} --api-key <PROVIDER_TOKEN>\n${exe} start ${cfg}`;

    const localWorkspaceCmd = `# Dev bootstrap (writes ${configPath})\n.\\scripts\\bootstrap-provider-dev.ps1 -ForceNewToken\n.\\scripts\\test-provider-auth.ps1\n\n# Terminal 1: daemon\n.\\scripts\\proxyhubb-cli.ps1 start\n\n# Terminal 2: live TUI\n.\\scripts\\proxyhubb-cli.ps1 dashboard`;

    const configTemplate = `# provider.toml — prefer Dashboard → My nodes → Connect for a filled file
control_api_url = "${endpoints.controlApiUrl}"
gateway_addr = "${endpoints.gatewayTunnelAddr}"
api_key = "<provider_token from Dashboard → API tokens>"
node_id = "<node_uuid from Setup or My nodes — not a new register>"
provider_signing_key = "<generated in Connect panel>"
connection_type = "residential"
use_tls = true
jwt_token = ""
metrics_port = 9090`;

    const steps = downloadInfo
        ? [
            { step: '1', label: 'Download binary', desc: 'Platform build above (or GitHub Release zip)' },
            { step: '2', label: 'Get config', desc: 'Setup wizard or My nodes → Connect (preferred over register)' },
            { step: '3', label: 'Pre-flight', desc: `${exe} doctor ${cfg}` },
            { step: '4', label: 'Start daemon', desc: `${exe} start ${cfg}` },
            { step: '5', label: 'Confirm online', desc: 'Operator console / My nodes within ~2 minutes' },
        ]
        : [];

    return (
        <div className="space-y-6 animate-in fade-in duration-500 pb-20">
            <div className="flex flex-col gap-2 border-b border-border pb-6">
                <div className="flex items-center gap-2 text-primary font-mono text-xs font-bold uppercase tracking-widest">
                    <FileCode size={14} />
                    Provider Tools
                </div>
                <h1 className="text-3xl font-bold font-mono uppercase tracking-tight">Provider Node CLI</h1>
                <p className="text-muted-foreground font-mono text-xs max-w-2xl">
                    Download <strong className="text-foreground">provider-node</strong> for your OS.
                    Default config: <code className="text-primary">{configPath}</code>.
                    {' '}API: <code className="text-primary">{endpoints.controlApiUrl}</code>
                    {' · '}Gateway: <code className="text-primary">{endpoints.gatewayTunnelAddr}</code>.
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                    <Link
                        href="/dashboard/provider/setup"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20 font-mono text-[10px] font-bold uppercase"
                    >
                        <Link2 size={12} /> Setup wizard first
                    </Link>
                    <Link
                        href="/dashboard/provider/nodes"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 text-muted-foreground border border-white/10 font-mono text-[10px] font-bold uppercase hover:text-foreground"
                    >
                        My nodes
                    </Link>
                    <Link
                        href="/dashboard/provider/tokens"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 text-muted-foreground border border-white/10 font-mono text-[10px] font-bold uppercase hover:text-foreground"
                    >
                        API tokens
                    </Link>
                    <a
                        href={releasesUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 text-muted-foreground border border-white/10 font-mono text-[10px] font-bold uppercase hover:text-foreground"
                    >
                        <Github size={12} /> GitHub Releases
                    </a>
                </div>
            </div>

            <GlassCard hoverEffect={false}>
                <h2 className="text-sm font-bold font-mono mb-4 flex items-center gap-2">
                    <Download size={14} className="text-primary" />
                    Download CLI {version !== '…' && <span className="text-primary/60">v{version}</span>}
                </h2>

                <div className="flex flex-wrap gap-2 mb-5">
                    {PLATFORMS.map((p) => {
                        const Icon = p.icon;
                        const available = p.archs.some((a) => platformHasBuild(data?.downloads, p.id, a));
                        return (
                            <button
                                key={p.id}
                                type="button"
                                disabled={!available && !isLoading}
                                onClick={() => {
                                    setSelectedPlatform(p.id);
                                    const arch = p.archs.find((a) => platformHasBuild(data?.downloads, p.id, a)) ?? p.archs[0];
                                    setSelectedArch(arch);
                                }}
                                className={`flex items-center gap-2 px-4 py-2 rounded-xl font-mono text-xs font-bold uppercase transition-colors ${
                                    selectedPlatform === p.id
                                        ? 'bg-primary text-primary-foreground'
                                        : available
                                        ? 'bg-white/5 hover:bg-white/10 text-muted-foreground'
                                        : 'bg-white/[0.02] text-muted-foreground/40 cursor-not-allowed'
                                }`}
                                title={available ? undefined : 'No build published for this OS yet'}
                            >
                                <Icon size={13} />
                                {p.label}
                                {!available && !isLoading && (
                                    <span className="text-[9px] opacity-60 normal-case font-normal">unavailable</span>
                                )}
                            </button>
                        );
                    })}
                </div>

                {platformConfig.archs.length > 1 && (
                    <div className="flex gap-2 mb-5">
                        {platformConfig.archs.map((a) => {
                            const available = platformHasBuild(data?.downloads, selectedPlatform, a);
                            return (
                                <button
                                    key={a}
                                    type="button"
                                    disabled={!available}
                                    onClick={() => setSelectedArch(a)}
                                    className={`px-3 py-1.5 rounded-lg font-mono text-xs transition-colors ${
                                        selectedArch === a
                                            ? 'bg-white/15 text-foreground font-bold'
                                            : available
                                            ? 'bg-white/5 text-muted-foreground hover:bg-white/10'
                                            : 'bg-white/[0.02] text-muted-foreground/40 cursor-not-allowed'
                                    }`}
                                >
                                    {a}
                                </button>
                            );
                        })}
                    </div>
                )}

                {isLoading ? (
                    <div className="flex items-center gap-3 py-6">
                        <Loader2 className="animate-spin text-primary" size={20} />
                        <span className="font-mono text-sm text-muted-foreground">Loading downloads…</span>
                    </div>
                ) : error ? (
                    <div className="flex items-center gap-3 py-4 text-red-400">
                        <AlertCircle size={16} />
                        <span className="font-mono text-sm">Failed to load downloads.</span>
                    </div>
                ) : downloadInfo ? (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between gap-4 bg-white/5 rounded-xl px-4 py-3">
                            <div className="flex items-center gap-3">
                                <Server size={16} className="text-primary" />
                                <div>
                                    <p className="text-sm font-mono font-bold">{downloadInfo.filename}</p>
                                    <p className="text-[10px] font-mono text-muted-foreground">
                                        {(downloadInfo.file_size / 1024 / 1024).toFixed(1)} MB · v{downloadInfo.version} · {packageType}
                                    </p>
                                </div>
                            </div>
                            <a
                                href={getCLIDownloadUrl(selectedPlatform, selectedArch, downloadInfo.version, packageType)}
                                download={downloadInfo.filename}
                                onClick={handleDownloadClick}
                                className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl font-mono text-xs font-bold uppercase hover:bg-primary/90 transition-colors"
                            >
                                <Download size={12} />
                                Download
                            </a>
                        </div>

                        {checksum && (
                            <div className="space-y-2">
                                <p className="text-[10px] font-mono uppercase text-muted-foreground mb-1.5">SHA256 Checksum</p>
                                <div className="flex items-center gap-2 bg-black/20 rounded-xl px-4 py-2.5 font-mono text-xs">
                                    <span className="text-muted-foreground flex-1 break-all select-all">{checksum}</span>
                                    <button
                                        type="button"
                                        onClick={() => copy(checksum, 'checksum')}
                                        className="shrink-0 text-muted-foreground hover:text-foreground"
                                        aria-label="Copy SHA256 checksum"
                                    >
                                        {copied === 'checksum'
                                            ? <CheckCircle2 size={12} className="text-emerald-400" />
                                            : <Copy size={12} />}
                                    </button>
                                </div>
                                <CodeBlock
                                    code={verifyChecksumCmd}
                                    id="verify-checksum"
                                    copied={copied === 'verify-checksum'}
                                    onCopy={() => copy(verifyChecksumCmd, 'verify-checksum')}
                                />
                            </div>
                        )}

                        <p className="text-[10px] font-mono text-muted-foreground">
                            Prefer a zip with launcher?{' '}
                            <a href={releasesUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline">
                                GitHub Releases (provider-v*)
                            </a>
                            {selectedPlatform === 'windows' && ' includes Launch-Provider-Console.cmd'}
                            .
                        </p>
                    </div>
                ) : (
                    <div className="py-4 text-center space-y-3">
                        <p className="text-muted-foreground font-mono text-sm">
                            No in-app build for {selectedPlatform}/{selectedArch} on this environment yet.
                        </p>
                        <a
                            href={releasesUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => setDownloadStarted(true)}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl font-mono text-xs font-bold uppercase"
                        >
                            <Github size={12} />
                            Download from GitHub Releases
                        </a>
                    </div>
                )}
            </GlassCard>

            {(downloadStarted || downloadInfo) && (
                <GlassCard hoverEffect={false}>
                    <div id="cli-next-steps" className="scroll-mt-24">
                        <h2 className="text-sm font-bold font-mono mb-2 flex items-center gap-2">
                            {downloadStarted ? (
                                <CheckCircle2 size={14} className="text-emerald-400" />
                            ) : (
                                <Terminal size={14} className="text-primary" />
                            )}
                            {downloadStarted ? 'Download started — open your console' : 'Open the interactive console'}
                        </h2>
                        <p className="text-[11px] font-mono text-muted-foreground mb-3">
                            The binary is a console app, not a silent installer. Running it with no arguments keeps a window open
                            with a menu (dashboard, doctor, start).
                        </p>
                        <CodeBlock
                            code={openConsoleCmd}
                            id="open-console"
                            copied={copied === 'open-console'}
                            onCopy={() => copy(openConsoleCmd, 'open-console')}
                        />
                    </div>
                </GlassCard>
            )}

            <GlassCard hoverEffect={false}>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <h2 className="text-sm font-bold font-mono flex items-center gap-2">
                        <Activity size={14} className="text-primary" />
                        Operator console
                    </h2>
                    <button
                        type="button"
                        onClick={() => refetchNodes()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 font-mono text-[10px] font-bold uppercase text-muted-foreground hover:text-foreground"
                    >
                        Refresh
                    </button>
                </div>
                <p className="text-[11px] font-mono text-muted-foreground mb-4">
                    Live view of your provider nodes from Control API. After the daemon heartbeats, status should flip online here.
                </p>
                {nodesLoading && !nodesData ? (
                    <div className="flex items-center gap-3 py-6">
                        <Loader2 className="animate-spin text-primary" size={18} />
                        <span className="font-mono text-xs text-muted-foreground">Loading nodes…</span>
                    </div>
                ) : nodes.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center space-y-2">
                        <p className="font-mono text-sm text-muted-foreground">No provider nodes yet.</p>
                        <p className="font-mono text-[10px] text-muted-foreground">
                            Finish Setup wizard, start the daemon from the console menu, then refresh.
                        </p>
                        <Link href="/dashboard/provider/setup" className="inline-flex text-primary font-mono text-[10px] uppercase font-bold">
                            Open setup wizard →
                        </Link>
                    </div>
                ) : (
                    <div className="space-y-3">
                        <p className="font-mono text-[10px] text-muted-foreground">
                            {onlineCount}/{nodes.length} online
                            {dataUpdatedAt ? ` · updated ${new Date(dataUpdatedAt).toLocaleTimeString()}` : ''}
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {nodes.map((node) => {
                                const online = /online|active|healthy/i.test(node.status);
                                return (
                                    <div key={node.id} className="rounded-xl bg-white/5 border border-white/10 px-4 py-3 space-y-1">
                                        <div className="flex items-center justify-between gap-2">
                                            <p className="font-mono text-xs font-bold truncate">{node.name || node.id}</p>
                                            <span className={`font-mono text-[10px] uppercase font-bold ${online ? 'text-emerald-400' : 'text-amber-400'}`}>
                                                {node.status}
                                            </span>
                                        </div>
                                        <p className="font-mono text-[10px] text-muted-foreground truncate">
                                            {node.country || '—'} · {node.connection_type || 'node'} · {node.latency_ms != null ? `${node.latency_ms}ms` : 'latency n/a'}
                                        </p>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </GlassCard>

            {downloadInfo && (
                <GlassCard hoverEffect={false}>
                    <h2 className="text-sm font-bold font-mono mb-2 flex items-center gap-2">
                        <Terminal size={14} className="text-primary" />
                        Quick Start
                    </h2>
                    <p className="text-[11px] font-mono text-amber-400/90 mb-3">
                        Prefer <Link href="/dashboard/provider/setup" className="underline text-primary">Setup</Link>
                        {' '}→ download config → <code className="text-foreground">start</code>.
                        Running <code className="text-foreground">register</code> after the wizard creates a second orphan node.
                    </p>
                    <CodeBlock
                        code={installCmd}
                        id="install"
                        copied={copied === 'install'}
                        onCopy={() => copy(installCmd, 'install')}
                    />
                    <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                        {steps.map((s) => (
                            <div key={s.step} className="flex items-start gap-3 bg-white/5 rounded-xl p-3">
                                <div className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center font-mono text-xs font-black shrink-0">
                                    {s.step}
                                </div>
                                <div className="min-w-0">
                                    <p className="text-xs font-bold font-mono">{s.label}</p>
                                    <p className="text-[10px] text-muted-foreground font-mono break-all">{s.desc}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="mt-5 pt-4 border-t border-border/60 space-y-2">
                        <p className="text-[10px] font-mono font-bold uppercase text-muted-foreground">
                            CLI-only path (new node — skip if you used Setup)
                        </p>
                        <p className="text-[10px] font-mono text-muted-foreground">
                            Create a token under{' '}
                            <Link href="/dashboard/provider/tokens" className="text-primary underline">API tokens</Link>
                            , then:
                        </p>
                        <CodeBlock
                            code={registerOnlyCmd}
                            id="register-only"
                            copied={copied === 'register-only'}
                            onCopy={() => copy(registerOnlyCmd, 'register-only')}
                        />
                    </div>
                </GlassCard>
            )}

            <GlassCard hoverEffect={false}>
                <h2 className="text-sm font-bold font-mono mb-4 flex items-center gap-2">
                    <Terminal size={14} className="text-primary" />
                    Local Dev Sequence
                </h2>
                <p className="text-xs text-muted-foreground font-mono mb-3">
                    Local stack only (Control API :18080, Gateway :3128). Production uses the URLs above.
                </p>
                <CodeBlock
                    code={localWorkspaceCmd}
                    id="local-sequence"
                    copied={copied === 'local-sequence'}
                    onCopy={() => copy(localWorkspaceCmd, 'local-sequence')}
                />
            </GlassCard>

            <GlassCard hoverEffect={false}>
                <h2 className="text-sm font-bold font-mono mb-4 flex items-center gap-2">
                    <FileCode size={14} className="text-primary" />
                    Config Template
                </h2>
                <p className="text-xs text-muted-foreground font-mono mb-3">
                    Save as <code className="text-primary">provider.toml</code> at{' '}
                    <code className="text-primary">{configPath}</code>. Prefer My nodes → Connect for a filled file.
                </p>
                <div className="mb-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 space-y-1.5">
                    <p className="text-[11px] font-mono text-foreground">Auth split:</p>
                    <p className="text-[11px] font-mono text-muted-foreground">
                        <code className="text-primary">api_key</code> — long-lived provider token from dashboard.
                    </p>
                    <p className="text-[11px] font-mono text-muted-foreground">
                        <code className="text-primary">jwt_token</code> — leave empty (auto-refreshed from api_key).
                    </p>
                    <p className="text-[11px] font-mono text-muted-foreground">
                        <code className="text-primary">provider_signing_key</code> — heartbeat hotkey. If your profile wallet is linked, prefer signing with that wallet rather than a random browser key.
                    </p>
                </div>
                <CodeBlock
                    code={configTemplate}
                    id="config"
                    copied={copied === 'config'}
                    onCopy={() => copy(configTemplate, 'config')}
                />
            </GlassCard>

            <GlassCard hoverEffect={false}>
                <h2 className="text-sm font-bold font-mono mb-4 flex items-center gap-2">
                    <Terminal size={14} className="text-primary" />
                    Common Commands
                </h2>
                <div className="space-y-2">
                    {[
                        { cmd: `${exe}`, desc: 'Interactive console menu (no args)' },
                        { cmd: `${exe} doctor ${cfg}`, desc: 'Pre-flight checks' },
                        { cmd: `${exe} start ${cfg}`, desc: 'Start daemon (preferred after Setup / Connect)' },
                        { cmd: `${exe} dashboard ${cfg}`, desc: 'Live TUI window' },
                        { cmd: `${exe} service install ${cfg}`, desc: 'Optional: install background service' },
                        { cmd: `${exe} service start`, desc: 'Optional: start installed service' },
                        { cmd: `${exe} status --json`, desc: 'Machine-readable status' },
                        { cmd: `${exe} register --api-url ${endpoints.controlApiUrl} --api-key <PROVIDER_TOKEN>`, desc: 'CLI-only: creates a NEW node (skip after wizard)' },
                        { cmd: `proxyhubb-cli join --api-url ${endpoints.controlApiUrl} --key <TOKEN> --gateway ${endpoints.gatewayTunnelAddr}`, desc: 'Onboarding wrapper' },
                    ].map(({ cmd, desc }) => (
                        <div key={cmd} className="flex items-center justify-between gap-4 px-4 py-2.5 rounded-xl hover:bg-white/5 transition-colors group">
                            <div className="flex items-center gap-3 min-w-0">
                                <code className="text-xs font-mono text-primary truncate">{cmd}</code>
                            </div>
                            <p className="text-xs text-muted-foreground font-mono shrink-0 hidden sm:block max-w-[40%] text-right">{desc}</p>
                            <button
                                type="button"
                                onClick={() => copy(cmd, cmd)}
                                className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                            >
                                {copied === cmd ? <CheckCircle2 size={12} className="text-emerald-400" /> : <Copy size={12} />}
                            </button>
                        </div>
                    ))}
                </div>
            </GlassCard>

            <div className="flex gap-3">
                <Link
                    href="/dashboard/provider/setup"
                    className="flex items-center gap-2 px-4 py-2 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 rounded-xl font-mono text-xs transition-colors"
                >
                    <ExternalLink size={12} />
                    Setup wizard
                </Link>
                <Link
                    href="/dashboard/provider/tokens"
                    className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl font-mono text-xs transition-colors"
                >
                    <ExternalLink size={12} />
                    API tokens
                </Link>
            </div>
        </div>
    );
}

function CodeBlock({
    code, id, copied, onCopy,
}: {
    code: string;
    id: string;
    copied: boolean;
    onCopy: () => void;
}) {
    return (
        <div className="relative bg-black/30 rounded-xl p-4 font-mono text-xs">
            <pre className="text-muted-foreground whitespace-pre-wrap break-all pr-8">{code}</pre>
            <button
                type="button"
                onClick={onCopy}
                className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors"
            >
                {copied ? <CheckCircle2 size={14} className="text-emerald-400" /> : <Copy size={14} />}
            </button>
        </div>
    );
}
