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
    const downloadKey = `${selectedPlatform}-${selectedArch}`;
    const downloadInfo: CLIDownload | undefined = data?.downloads?.[downloadKey];

    function copy(text: string, key: string) {
        navigator.clipboard.writeText(text);
        setCopied(key);
        setTimeout(() => setCopied(null), 2000);
    }

    const installCmd = selectedPlatform === 'windows'
        ? `# Download from above, then:\nprovider-cli.exe wizard`
        : selectedPlatform === 'macos'
        ? `# Download from above, then:\nchmod +x provider-cli-macos-${selectedArch}\nmv provider-cli-macos-${selectedArch} /usr/local/bin/provider-cli\nprovider-cli wizard`
        : `# Download from above, then:\nchmod +x provider-cli-linux-${selectedArch}\nmv provider-cli-linux-${selectedArch} /usr/local/bin/provider-cli\nprovider-cli wizard`;

    const configTemplate = `# ~/.proxyhubb/provider.yaml
api_key: "your_token_here"
gateway_addr: "gateway.proxyhubb.com:443"
use_tls: true
max_connections: 100
bandwidth_limit_mbps: 100
log_level: "info"
metrics_enabled: true
metrics_port: 9090`;

    return (
        <div className="space-y-6 animate-in fade-in duration-500 pb-20">
            {/* Header */}
            <div className="flex flex-col gap-2 border-b border-border pb-6">
                <div className="flex items-center gap-2 text-primary font-mono text-xs font-bold uppercase tracking-widest">
                    <FileCode size={14} />
                    Provider Tools
                </div>
                <h1 className="text-3xl font-bold font-mono uppercase tracking-tight">CLI & Tools</h1>
                <p className="text-muted-foreground font-mono text-xs max-w-lg">
                    DOWNLOAD THE PROVIDER CLI TO REGISTER AND RUN YOUR NODES.
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
                                        {(downloadInfo.file_size / 1024 / 1024).toFixed(1)} MB · v{downloadInfo.version}
                                    </p>
                                </div>
                            </div>
                            <a
                                href={getCLIDownloadUrl(selectedPlatform, selectedArch, downloadInfo.version)}
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
                        { step: '1', label: 'Download & install', desc: 'Move binary to PATH' },
                        { step: '2', label: 'Run wizard', desc: 'provider-cli wizard' },
                        { step: '3', label: 'Start node', desc: 'provider-cli node start' },
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

            {/* Config template */}
            <GlassCard hoverEffect={false}>
                <h2 className="text-sm font-bold font-mono mb-4 flex items-center gap-2">
                    <FileCode size={14} className="text-primary" />
                    Config Template
                </h2>
                <p className="text-xs text-muted-foreground font-mono mb-3">
                    Save this to <code className="text-primary">~/.proxyhubb/provider.yaml</code> and fill in your API token.
                </p>
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
                        { cmd: 'provider-cli wizard', desc: 'Interactive setup wizard' },
                        { cmd: 'provider-cli node start', desc: 'Start your node (connect to gateway)' },
                        { cmd: 'provider-cli node metrics', desc: 'View live bandwidth & connection stats' },
                        { cmd: 'provider-cli node status', desc: 'Check if node is running' },
                        { cmd: 'provider-cli node register', desc: 'Register a new node manually' },
                        { cmd: 'provider-cli service install', desc: 'Install as system service (auto-start on boot)' },
                        { cmd: 'provider-cli service logs', desc: 'View service logs' },
                        { cmd: 'provider-cli doctor', desc: 'Run diagnostics & health checks' },
                        { cmd: 'provider-cli update', desc: 'Update CLI to latest version' },
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
