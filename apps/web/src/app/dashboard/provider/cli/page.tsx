'use client';

import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/glass-card';
import {
    FileCode, Download, Copy, CheckCircle2, Terminal, Monitor,
    Apple, Server, Loader2, AlertCircle, ExternalLink, Link2
} from 'lucide-react';
import Link from 'next/link';
import { getCLIDownloads, getCLIDownloadUrl, detectPlatform, type CLIDownload } from '@/lib/api/provider';
import {
    defaultProviderConfigPath,
    getProviderEndpoints,
} from '@/lib/provider-config';

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
    // Fall back to any matching platform/arch entry
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

export default function CLIPage() {
    const [selectedPlatform, setSelectedPlatform] = useState('linux');
    const [selectedArch, setSelectedArch] = useState('amd64');
    const [copied, setCopied] = useState<string | null>(null);
    const endpoints = useMemo(() => getProviderEndpoints(), []);
    const configPath = useMemo(() => defaultProviderConfigPath(), []);
    const exe = selectedPlatform === 'windows' ? 'provider-node.exe' : 'provider-node';

    const { data, isLoading, error } = useQuery({
        queryKey: ['cli-downloads'],
        queryFn: getCLIDownloads,
        staleTime: 5 * 60_000,
    });

    useEffect(() => {
        const { platform, arch } = detectPlatform();
        setSelectedPlatform(platform);
        setSelectedArch(arch);
    }, []);

    // If selected platform has no build, jump to first available
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

    function copy(text: string, key: string) {
        navigator.clipboard.writeText(text);
        setCopied(key);
        setTimeout(() => setCopied(null), 2000);
    }

    const installCmd = selectedPlatform === 'windows'
        ? `# Recommended (after Setup wizard downloaded provider.toml):\n# Do NOT run register again — that creates a second node.\n${exe} config validate --config provider.toml\n${exe} doctor --config provider.toml\n${exe} service install --config provider.toml\n${exe} service start\n${exe} service status\n\n# CLI-only path (new node, no wizard):\n${exe} register --api-url ${endpoints.controlApiUrl} --api-key <PROVIDER_TOKEN>\n${exe} start --config provider.toml`
        : `# Recommended (after Setup wizard downloaded provider.toml):\n# Do NOT run register again — that creates a second node.\nchmod +x ./${binaryHint}\nsudo mv ./${binaryHint} /usr/local/bin/provider-node\nprovider-node config validate --config provider.toml\nprovider-node doctor --config provider.toml\nprovider-node service install --config provider.toml\nprovider-node service start\n\n# CLI-only path (new node, no wizard):\nprovider-node register --api-url ${endpoints.controlApiUrl} --api-key <PROVIDER_TOKEN>\nprovider-node start --config provider.toml`;

    const localWorkspaceCmd = `# Dev bootstrap (writes ${configPath})\n.\\scripts\\bootstrap-provider-dev.ps1 -ForceNewToken\n.\\scripts\\test-provider-auth.ps1\n\n# Terminal 1: daemon\n.\\scripts\\proxyhubb-cli.ps1 start\n\n# Terminal 2: live TUI\n.\\scripts\\proxyhubb-cli.ps1 dashboard`;

    const configTemplate = `# provider.toml — use Dashboard → My nodes → Connect for production URLs
control_api_url = "${endpoints.controlApiUrl}"
gateway_addr = "${endpoints.gatewayTunnelAddr}"
api_key = "<provider_token>"
node_id = "<node_uuid_from_setup_or_register>"
provider_signing_key = "<run provider-node keygen, or use linked wallet as hotkey>"
connection_type = "residential"
use_tls = ${endpoints.useTls}
jwt_token = ""
metrics_port = 9090`;

    const steps = downloadInfo
        ? [
            { step: '1', label: 'Download binary', desc: 'Use the platform build above' },
            { step: '2', label: 'Get config', desc: 'Setup wizard or My nodes → Connect (preferred over register)' },
            { step: '3', label: 'Validate config', desc: `${exe} config validate --config provider.toml` },
            { step: '4', label: 'Pre-flight', desc: `${exe} doctor --config provider.toml` },
            { step: '5', label: 'Start daemon', desc: `${exe} start --config provider.toml` },
            { step: '6', label: 'Confirm online', desc: 'Dashboard → My nodes within ~2 minutes' },
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
                    Default config path: <code className="text-primary">{configPath}</code>.
                    API: <code className="text-primary">{endpoints.controlApiUrl}</code>.
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
                                className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl font-mono text-xs font-bold uppercase hover:bg-primary/90 transition-colors"
                            >
                                <Download size={12} />
                                Download
                            </a>
                        </div>

                        {downloadInfo.checksum && (
                            <div>
                                <p className="text-[10px] font-mono uppercase text-muted-foreground mb-1.5">SHA256 Checksum</p>
                                <div className="flex items-center gap-2 bg-black/20 rounded-xl px-4 py-2.5 font-mono text-xs">
                                    <span className="text-muted-foreground flex-1 break-all">{downloadInfo.checksum}</span>
                                    <button
                                        type="button"
                                        onClick={() => copy(downloadInfo.checksum, 'checksum')}
                                        className="shrink-0 text-muted-foreground hover:text-foreground"
                                    >
                                        {copied === 'checksum'
                                            ? <CheckCircle2 size={12} className="text-emerald-400" />
                                            : <Copy size={12} />}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="py-4 text-center space-y-2">
                        <p className="text-muted-foreground font-mono text-sm">
                            No build published for {selectedPlatform}/{selectedArch} in this environment.
                        </p>
                        <p className="text-[10px] font-mono text-muted-foreground">
                            Switch to an available OS tab, or ask an admin to publish via{' '}
                            <code className="text-primary">scripts/publish-cli-dist.sh</code>.
                        </p>
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
                        Prefer Setup → download config → start. Running <code>register</code> after the wizard creates a second orphan node.
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
                                <div>
                                    <p className="text-xs font-bold font-mono">{s.label}</p>
                                    <p className="text-[10px] text-muted-foreground font-mono">{s.desc}</p>
                                </div>
                            </div>
                        ))}
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
                        { cmd: `${exe} start --config provider.toml`, desc: 'Start daemon (preferred after wizard)' },
                        { cmd: `${exe} register --api-url ${endpoints.controlApiUrl} --api-key <PROVIDER_TOKEN>`, desc: 'CLI-only: create a new node' },
                        { cmd: `${exe} keygen`, desc: 'Generate provider_signing_key' },
                        { cmd: `${exe} config validate --config provider.toml`, desc: 'Offline config validation' },
                        { cmd: `${exe} doctor --config provider.toml`, desc: 'Pre-flight checks' },
                        { cmd: `${exe} service install --config provider.toml`, desc: 'Install background service' },
                        { cmd: `${exe} service start`, desc: 'Start installed service' },
                        { cmd: `${exe} status --json`, desc: 'Machine-readable status' },
                        { cmd: `proxyhubb-cli join --api-url ${endpoints.controlApiUrl} --key <TOKEN> --gateway ${endpoints.gatewayTunnelAddr}`, desc: 'Onboarding wrapper' },
                    ].map(({ cmd, desc }) => (
                        <div key={cmd} className="flex items-center justify-between gap-4 px-4 py-2.5 rounded-xl hover:bg-white/5 transition-colors group">
                            <div className="flex items-center gap-3 min-w-0">
                                <code className="text-xs font-mono text-primary truncate">{cmd}</code>
                            </div>
                            <p className="text-xs text-muted-foreground font-mono shrink-0 hidden sm:block">{desc}</p>
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
