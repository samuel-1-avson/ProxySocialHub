'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/glass-card';
import { motion } from 'framer-motion';
import {
    FileCode, Download, Copy, CheckCircle2, Terminal, Monitor,
    Apple, Server, Loader2, AlertCircle, ExternalLink
} from 'lucide-react';
import { getCLIDownloads, getCLIDownloadUrl, detectPlatform, type CLIDownload } from '@/lib/api/provider';

const PLATFORMS = [
    { id: 'linux', label: 'Linux', icon: Terminal, archs: ['amd64', 'arm64'] },
    { id: 'windows', label: 'Windows', icon: Monitor, archs: ['amd64'] },
    { id: 'macos', label: 'macOS', icon: Apple, archs: ['amd64', 'arm64'] },
];

export default function CLIPage() {
    const [selectedPlatform, setSelectedPlatform] = useState('linux');
    const [selectedArch, setSelectedArch] = useState('amd64');
    const [copied, setCopied] = useState<string | null>(null);

    const { data, isLoading, error } = useQuery({
        queryKey: ['cli-downloads'],
        queryFn: getCLIDownloads,
        staleTime: 5 * 60_000,
    });

    // Auto-detect platform on mount
    useEffect(() => {
        const { platform, arch } = detectPlatform();
        setSelectedPlatform(platform);
        setSelectedArch(arch);
    }, []);

    const version = data?.latest_version ?? '…';
    const platformConfig = PLATFORMS.find((p) => p.id === selectedPlatform) ?? PLATFORMS[0];
    const bundleKey = `${selectedPlatform}_${selectedArch}_bundle`;
    const downloadKey = `${selectedPlatform}_${selectedArch}`;
    const legacyDownloadKey = `${selectedPlatform}-${selectedArch}`;
    const downloadInfo: CLIDownload | undefined =
        data?.downloads?.[bundleKey] ?? data?.downloads?.[downloadKey] ?? data?.downloads?.[legacyDownloadKey];
    const packageType = downloadInfo?.package_type ?? 'daemon';

    function copy(text: string, key: string) {
        navigator.clipboard.writeText(text);
        setCopied(key);
        setTimeout(() => setCopied(null), 2000);
    }

    const binaryHint = downloadInfo?.filename ?? 'provider-node';

    const installCmd = selectedPlatform === 'windows'
        ? `# 1. Download provider-node or the bundle above (${binaryHint})\n# 2. Create and validate provider.toml\nprovider-node.exe register --api-url http://localhost:18080 --api-key <PROVIDER_TOKEN>\nprovider-node.exe config validate --config provider.toml\nprovider-node.exe doctor --config provider.toml\n\n# 3. Install as a background service (Administrator terminal)\nprovider-node.exe service install --config provider.toml\nprovider-node.exe service start\nprovider-node.exe service status`
        : `# 1. Download and install the binary or bundle\nchmod +x ./${binaryHint}\nsudo mv ./${binaryHint} /usr/local/bin/provider-node\n\n# 2. Register, validate, and run pre-flight checks\nprovider-node register --api-url http://localhost:18080 --api-key <PROVIDER_TOKEN>\nprovider-node config validate --config provider.toml\nprovider-node doctor --config provider.toml\n\n# 3. Install and start as a background service\nprovider-node service install --config provider.toml\nprovider-node service start\nprovider-node service status`;

    const localWorkspaceCmd = `# Dev bootstrap (writes %APPDATA%\\proxyhubb\\provider.toml)\n.\\scripts\\bootstrap-provider-dev.ps1 -ForceNewToken\n.\\scripts\\test-provider-auth.ps1\n\n# Terminal 1: daemon\n.\\scripts\\proxyhubb-cli.ps1 start\n\n# Terminal 2: live TUI (metrics, nodes, earnings, logs)\n.\\scripts\\proxyhubb-cli.ps1 dashboard\n\n# Headless refresh loop (no curses)\n.\\scripts\\proxyhubb-cli.ps1 watch`;

    const configTemplate = `# provider.toml (Dashboard → Nodes → Connect, or proxyhubb-cli join)
control_api_url = "http://localhost:18080"
gateway_addr = "localhost:3128"
api_key = "<provider_token>"
node_id = "<node_uuid>"
provider_signing_key = "<generated_by_provider-node_keygen_or_register>"
connection_type = "residential"
use_tls = false
jwt_token = ""
metrics_port = 9090`;

    return (
        <div className="space-y-6 animate-in fade-in duration-500 pb-20">
            {/* Header */}
            <div className="flex flex-col gap-2 border-b border-border pb-6">
                <div className="flex items-center gap-2 text-primary font-mono text-xs font-bold uppercase tracking-widest">
                    <FileCode size={14} />
                    Provider Tools
                </div>
                <h1 className="text-3xl font-bold font-mono uppercase tracking-tight">Provider Node CLI</h1>
                <p className="text-muted-foreground font-mono text-xs max-w-lg">
                    Download <strong className="text-foreground">provider-node</strong> or the provider bundle for your OS.{' '}
                    <code className="text-primary">proxyhubb-cli</code> is the onboarding wrapper (join, doctor, dashboard) and
                    delegates runtime commands to provider-node. Config default:{' '}
                    <code className="text-primary">%APPDATA%\proxyhubb\provider.toml</code> on Windows.
                </p>
            </div>

            {/* Platform selector */}
            <GlassCard hoverEffect={false}>
                <h2 className="text-sm font-bold font-mono mb-4 flex items-center gap-2">
                    <Download size={14} className="text-primary" />
                    Download CLI {version !== '…' && <span className="text-primary/60">v{version}</span>}
                </h2>

                {/* OS tabs */}
                <div className="flex gap-2 mb-5">
                    {PLATFORMS.map((p) => {
                        const Icon = p.icon;
                        return (
                            <button
                                key={p.id}
                                onClick={() => {
                                    setSelectedPlatform(p.id);
                                    setSelectedArch(p.archs[0]);
                                }}
                                className={`flex items-center gap-2 px-4 py-2 rounded-xl font-mono text-xs font-bold uppercase transition-colors ${
                                    selectedPlatform === p.id
                                        ? 'bg-primary text-primary-foreground'
                                        : 'bg-white/5 hover:bg-white/10 text-muted-foreground'
                                }`}
                            >
                                <Icon size={13} />
                                {p.label}
                            </button>
                        );
                    })}
                </div>

                {/* Arch selector */}
                {platformConfig.archs.length > 1 && (
                    <div className="flex gap-2 mb-5">
                        {platformConfig.archs.map((a) => (
                            <button
                                key={a}
                                onClick={() => setSelectedArch(a)}
                                className={`px-3 py-1.5 rounded-lg font-mono text-xs transition-colors ${
                                    selectedArch === a
                                        ? 'bg-white/15 text-foreground font-bold'
                                        : 'bg-white/5 text-muted-foreground hover:bg-white/10'
                                }`}
                            >
                                {a}
                            </button>
                        ))}
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
                    <div className="py-4 text-center text-muted-foreground font-mono text-sm">
                        No build available for {selectedPlatform}/{selectedArch} yet.
                    </div>
                )}
            </GlassCard>

            {/* Quick install */}
            <GlassCard hoverEffect={false}>
                <h2 className="text-sm font-bold font-mono mb-4 flex items-center gap-2">
                    <Terminal size={14} className="text-primary" />
                    Quick Start
                </h2>
                <CodeBlock
                    code={installCmd}
                    id="install"
                    copied={copied === 'install'}
                    onCopy={() => copy(installCmd, 'install')}
                />
                <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                    {[
                        { step: '1', label: 'Download binary', desc: 'Use the platform build above' },
                        { step: '2', label: 'Register node', desc: 'provider-node register --api-key <TOKEN> --config provider.toml' },
                        { step: '3', label: 'Validate config', desc: 'provider-node config validate --config provider.toml' },
                        { step: '4', label: 'Pre-flight', desc: 'provider-node doctor --config provider.toml' },
                        { step: '5', label: 'Start daemon', desc: 'provider-node start --config provider.toml' },
                        { step: '6', label: 'Status / metrics', desc: 'provider-node status · provider-node metrics' },
                    ].map((s) => (
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

            {/* Local workspace sequence */}
            <GlassCard hoverEffect={false}>
                <h2 className="text-sm font-bold font-mono mb-4 flex items-center gap-2">
                    <Terminal size={14} className="text-primary" />
                    Local Dev Sequence (Verified)
                </h2>
                <p className="text-xs text-muted-foreground font-mono mb-3">
                    This is the exact command sequence validated in the current local stack (Control API on :18080, Edge Gateway on :3128).
                </p>
                <CodeBlock
                    code={localWorkspaceCmd}
                    id="local-sequence"
                    copied={copied === 'local-sequence'}
                    onCopy={() => copy(localWorkspaceCmd, 'local-sequence')}
                />
            </GlassCard>

            {/* Config template */}
            <GlassCard hoverEffect={false}>
                <h2 className="text-sm font-bold font-mono mb-4 flex items-center gap-2">
                    <FileCode size={14} className="text-primary" />
                    Config Template
                </h2>
                <p className="text-xs text-muted-foreground font-mono mb-3">
                    Save as <code className="text-primary">provider.toml</code>. The dashboard connect flow or{' '}
                    <code className="text-primary">proxyhubb-cli join</code> can generate this file.
                </p>
                <div className="mb-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 space-y-1.5">
                    <p className="text-[11px] font-mono text-foreground">
                        Auth split (do not confuse these):
                    </p>
                    <p className="text-[11px] font-mono text-muted-foreground">
                        <code className="text-primary">api_key</code> — long-lived provider token from dashboard. Preferred.
                        Runtime exchanges it via <code className="text-primary">POST /v1/provider/gateway-token</code> for a ~1h JWT (auto-refreshed).
                    </p>
                    <p className="text-[11px] font-mono text-muted-foreground">
                        <code className="text-primary">jwt_token</code> — leave empty. Only for legacy/debug; cannot refresh and expires with the gateway JWT TTL.
                    </p>
                    <p className="text-[11px] font-mono text-muted-foreground">
                        <code className="text-primary">POST /v1/provider/auth</code> — used by <code className="text-primary">join</code>/<code className="text-primary">register</code> for Control API CRUD during onboarding, not by the running daemon tunnel.
                    </p>
                </div>
                <CodeBlock
                    code={configTemplate}
                    id="config"
                    copied={copied === 'config'}
                    onCopy={() => copy(configTemplate, 'config')}
                />
            </GlassCard>

            {/* CLI Commands reference */}
            <GlassCard hoverEffect={false}>
                <h2 className="text-sm font-bold font-mono mb-4 flex items-center gap-2">
                    <Terminal size={14} className="text-primary" />
                    Common Commands
                </h2>
                <div className="space-y-2">
                    {[
                        { cmd: 'provider-node register --api-url http://localhost:18080 --api-key <PROVIDER_TOKEN>', desc: 'Register node and write provider.toml' },
                        { cmd: 'provider-node keygen', desc: 'Generate provider_signing_key for signed heartbeats' },
                        { cmd: 'provider-node config validate --config provider.toml', desc: 'Offline config validation with exact fixes' },
                        { cmd: 'provider-node start --config provider.toml', desc: 'Start daemon and gateway tunnel' },
                        { cmd: 'provider-node doctor --config provider.toml', desc: 'Pre-flight: config, auth, gateway, signing key' },
                        { cmd: 'provider-node dashboard --config provider.toml', desc: 'Live TUI: metrics, earnings, gateway, logs' },
                        { cmd: 'provider-node watch --config provider.toml', desc: 'Refreshing terminal status until Ctrl+C' },
                        { cmd: 'provider-node install', desc: 'Show canonical paths and install hints' },
                        { cmd: 'provider-node service install --config provider.toml', desc: 'Install background service' },
                        { cmd: 'provider-node service start', desc: 'Start installed service' },
                        { cmd: 'provider-node service stop', desc: 'Stop installed service' },
                        { cmd: 'provider-node service status --json', desc: 'Machine-readable service health' },
                        { cmd: 'provider-node support bundle --config provider.toml', desc: 'Export redacted support diagnostics' },
                        { cmd: 'proxyhubb-cli join --api-url http://localhost:18080 --key <TOKEN> --gateway localhost:3128', desc: 'Onboarding → writes canonical provider.toml' },
                        { cmd: 'proxyhubb-cli doctor', desc: 'Pre-flight (delegates to provider-node)' },
                        { cmd: 'proxyhubb-cli dashboard', desc: 'Live TUI (delegates to provider-node)' },
                        { cmd: 'proxyhubb-cli watch', desc: 'Refreshing status loop' },
                        { cmd: 'proxyhubb-cli paths', desc: 'Show config, state, PID, log paths' },
                        { cmd: 'provider-node status --json', desc: 'PID, metrics, Control API nodes (scripting)' },
                        { cmd: 'provider-node metrics', desc: 'Read local stats (default port 9090)' },
                        { cmd: 'provider-node stop', desc: 'Stop daemon (Unix: SIGTERM; Windows: manual)' },
                    ].map(({ cmd, desc }) => (
                        <div key={cmd} className="flex items-center justify-between gap-4 px-4 py-2.5 rounded-xl hover:bg-white/5 transition-colors group">
                            <div className="flex items-center gap-3 min-w-0">
                                <code className="text-xs font-mono text-primary">{cmd}</code>
                            </div>
                            <p className="text-xs text-muted-foreground font-mono shrink-0 hidden sm:block">{desc}</p>
                            <button
                                onClick={() => copy(cmd, cmd)}
                                className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                            >
                                {copied === cmd ? <CheckCircle2 size={12} className="text-emerald-400" /> : <Copy size={12} />}
                            </button>
                        </div>
                    ))}
                </div>
            </GlassCard>

            {/* Links */}
            <div className="flex gap-3">
                <a
                    href="https://docs.proxyhubb.com/cli"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl font-mono text-xs transition-colors"
                >
                    <ExternalLink size={12} />
                    Full Documentation
                </a>
                <a
                    href="https://github.com/proxyhubb"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl font-mono text-xs transition-colors"
                >
                    <ExternalLink size={12} />
                    GitHub
                </a>
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
                onClick={onCopy}
                className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors"
            >
                {copied ? <CheckCircle2 size={14} className="text-emerald-400" /> : <Copy size={14} />}
            </button>
        </div>
    );
}
