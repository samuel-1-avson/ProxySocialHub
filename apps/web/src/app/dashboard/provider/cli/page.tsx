'use client';

import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    Download, Copy, CheckCircle2, Terminal, Monitor,
    Apple, Server, Github, Activity
} from 'lucide-react';
import Link from 'next/link';
import {
    getCLIDownloads,
    getCLIDownloadUrl,
    getProviderAppDownloadUrl,
    getProviderAppReleasesUrl,
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
import {
    PageHeading,
    Loading,
    DataError,
    EmptyState,
    Status,
} from '@/components/workspace/Patterns';

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
    // Prefer the live daemon binary (Control API latest) over an older zip bundle.
    const keys = [
        `${platform}_${arch}`,
        `${platform}_${arch}_daemon`,
        `${platform}-${arch}`,
        `${platform}_${arch}_bundle`,
    ];
    for (const key of keys) {
        if (downloads[key]) return downloads[key];
    }
    const normPlat = platform.toLowerCase();
    const normArch = arch === 'amd64' ? 'x64' : arch;
    const pool = Object.values(downloads).filter((d) => {
        const p = (d.platform || '').toLowerCase();
        const a = (d.arch || '').toLowerCase();
        const platOk =
            p === normPlat ||
            (normPlat === 'windows' && p === 'windows') ||
            (normPlat === 'macos' && (p === 'macos' || p === 'darwin')) ||
            (normPlat === 'linux' && p === 'linux');
        const archOk = a === arch || a === normArch || (arch === 'amd64' && a === 'x64');
        return platOk && archOk;
    });
    return (
        pool.find((d) => !d.package_type || d.package_type === 'daemon') ??
        pool[0]
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

/** On Windows the one-line installer is the main path; manual downloads collapse. */
function ManualDownloadWrap({ collapsed, children }: { collapsed: boolean; children: React.ReactNode }) {
    if (!collapsed) return <>{children}</>;
    return (
        <details className="ui-note">
            <summary>Advanced: manual download</summary>
            <div className="ui-section-space">{children}</div>
        </details>
    );
}

/** Shell-safe --config flag for the selected OS (PowerShell on Windows). */
function configFlag(platform: string): string {
    if (platform === 'windows') {
        return '--config "$env:APPDATA\\proxyhubb\\provider.toml"';
    }
    if (platform === 'macos') {
        return '--config "$HOME/Library/Application Support/proxyhubb/provider.toml"';
    }
    return '--config ~/.config/proxyhubb/provider.toml';
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
    const appReleasesUrl = useMemo(() => getProviderAppReleasesUrl(), []);
    const exe = selectedPlatform === 'windows' ? 'provider-node.exe' : 'provider-node';
    const cfg = configFlag(selectedPlatform);

    const { data, isLoading, error, refetch } = useQuery({
        queryKey: ['cli-downloads'],
        queryFn: getCLIDownloads,
        staleTime: 5 * 60_000,
    });

    const {
        data: nodesData,
        isLoading: nodesLoading,
        refetch: refetchNodes,
        dataUpdatedAt,
        error: nodesError,
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
    // Desktop installer row (package_type=desktop), served by Control API.
    // Prefer the Windows build; the app is Windows-only for now.
    const desktopInfo = useMemo(() => {
        if (!data?.downloads) return undefined;
        const pool = Object.values(data.downloads).filter(
            (d) => (d.package_type || '').toLowerCase() === 'desktop',
        );
        return (
            pool.find((d) => (d.platform || '').toLowerCase() === 'windows') ??
            pool[0]
        );
    }, [data]);
    const desktopChecksum = formatChecksum(desktopInfo?.checksum);
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
                ? 'Open the .exe (or Launch-Provider-Console.cmd from a GitHub Release zip). A console window stays open with the interactive menu.'
                : 'Run the binary in a terminal with no arguments to open the interactive Provider console.',
        );
        requestAnimationFrame(() => {
            document.getElementById('cli-next-steps')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    }

    const installScriptUrl = `${endpoints.controlApiUrl}/v1/cli/install.ps1`;
    const oneLineInstallCmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "irm ${installScriptUrl} | iex"`;
    const checksum = formatChecksum(downloadInfo?.checksum);
    const verifyChecksumCmd = selectedPlatform === 'windows'
        ? (checksum
            ? `# PowerShell: verify download\nGet-FileHash .\\${binaryHint} -Algorithm SHA256\n# expect: ${checksum}`
            : `# PowerShell: verify download\nGet-FileHash .\\${binaryHint} -Algorithm SHA256`)
        : (checksum
            ? `# verify download\nshasum -a 256 ./${binaryHint}\n# expect: ${checksum}`
            : `# verify download\nshasum -a 256 ./${binaryHint}`);

    const openConsoleCmd = selectedPlatform === 'windows'
        ? `# After download (browser Downloads folder):\n# Option A: double-click the .exe (interactive console)\n# Option B: from a Release zip, double-click Launch-Provider-Console.cmd\n\ncd $env:USERPROFILE\\Downloads\n.\\${binaryHint}\n\n# Put provider.toml at:\n#   ${configPath}\n# Prefer: Setup wizard / My nodes → Connect (do not register again)`
        : `# After download:\nchmod +x ./${binaryHint}\n# Optional install onto PATH:\n# sudo mv ./${binaryHint} /usr/local/bin/provider-node\n\n./${binaryHint}\n\n# Config path: ${configPath}\n# Prefer: Setup wizard / My nodes → Connect (do not register again)`;

    const installCmd = selectedPlatform === 'windows'
        ? `# Recommended: after Setup / My nodes → Connect saved provider.toml\n# Do NOT run register again (creates a second orphan node).\n${exe} doctor ${cfg}\n${exe} start ${cfg}\n\n# Optional: start automatically each time you sign in to Windows:\n# ${exe} service install ${cfg}\n# ${exe} service start\n# ${exe} service status`
        : `# Recommended: after Setup / My nodes → Connect saved provider.toml\n# Do NOT run register again (creates a second orphan node).\nchmod +x ./${binaryHint}\n./${binaryHint} doctor ${cfg}\n./${binaryHint} start ${cfg}\n\n# Optional: systemd/launchd service instead of foreground start:\n# provider-node service install ${cfg}\n# provider-node service start`;

    const registerOnlyCmd = `${exe} register --api-url ${endpoints.controlApiUrl} --api-key <PROVIDER_TOKEN>\n${exe} start ${cfg}`;

    const localWorkspaceCmd = `# Dev bootstrap (writes ${configPath})\n.\\scripts\\bootstrap-provider-dev.ps1 -ForceNewToken\n.\\scripts\\test-provider-auth.ps1\n\n# Terminal 1: daemon\n.\\scripts\\proxyhubb-cli.ps1 start\n\n# Terminal 2: live TUI\n.\\scripts\\proxyhubb-cli.ps1 dashboard`;

    const configTemplate = `# provider.toml: prefer Dashboard → My nodes → Connect for a filled file
control_api_url = "${endpoints.controlApiUrl}"
gateway_addr = "${endpoints.gatewayTunnelAddr}"
api_key = "<provider_token from Dashboard → API tokens>"
node_id = "<node_uuid from Setup or My nodes, not a new register>"
provider_signing_key = "<generated in Connect panel>"
connection_type = "residential"
use_tls = true
jwt_token = ""
metrics_port = 9090`;

    const steps = downloadInfo
        ? [
            { step: '1', label: 'Install', desc: selectedPlatform === 'windows' ? 'One-line install above, or platform build / GitHub Release zip' : 'Platform build above (or GitHub Release zip)' },
            { step: '2', label: 'Get config', desc: 'Setup wizard, My nodes → Connect, or `provider-node pair` (preferred over register)' },
            { step: '3', label: 'Pre-flight', desc: `${exe} doctor ${cfg}` },
            { step: '4', label: 'Start daemon', desc: `${exe} start ${cfg}` },
            { step: '5', label: 'Confirm online', desc: 'Operator console / My nodes within ~2 minutes' },
        ]
        : [];

    return (
        <div className="ui-page">
            <PageHeading
                eyebrow="Provider tools"
                title="Provider node CLI"
                description={`Download provider-node for your OS. Default config is ${configPath}. API: ${endpoints.controlApiUrl}. Gateway: ${endpoints.gatewayTunnelAddr}.`}
                actions={
                    <>
                        <Link href="/dashboard/provider/setup" className="ui-button">
                            Setup wizard first
                        </Link>
                        <Link href="/dashboard/provider/nodes" className="ui-button secondary">
                            My nodes
                        </Link>
                        <Link href="/dashboard/provider/tokens" className="ui-button secondary">
                            API tokens
                        </Link>
                        <a
                            href={releasesUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ui-button secondary"
                        >
                            <Github size={14} aria-hidden="true" /> GitHub Releases
                        </a>
                    </>
                }
            />

            <section className="ui-surface" id="desktop-app">
                <div className="ui-section-heading">
                    <h2>
                        Desktop app{' '}
                        <span className="text-muted-foreground">Windows · no terminal needed</span>
                    </h2>
                </div>
                <p className="ui-note">
                    Prefer no command line? Install the Provider app, press Connect, and approve
                    the pairing code in your dashboard. It runs the same node as the CLI below,
                    straight from the system tray.
                </p>
                {isLoading ? (
                    <Loading label="Checking for the desktop installer…" />
                ) : desktopInfo ? (
                    <div className="ui-page ui-section-space">
                        <div className="ui-row">
                            <div className="ui-row-identity">
                                <span className="ui-region">
                                    <Monitor size={16} aria-hidden="true" />
                                </span>
                                <div>
                                    <h3>{desktopInfo.filename}</h3>
                                    <p>
                                        {(desktopInfo.file_size / 1024 / 1024).toFixed(1)} MB · v{desktopInfo.version} · Windows 10/11 (64-bit)
                                    </p>
                                </div>
                            </div>
                            <a
                                href={getProviderAppDownloadUrl(desktopInfo.version)}
                                download={desktopInfo.filename}
                                onClick={() => setDownloadStarted(true)}
                                className="ui-button"
                            >
                                <Download size={14} aria-hidden="true" />
                                Download for Windows
                            </a>
                        </div>
                        {desktopChecksum && (
                            <div>
                                <p className="ui-note">SHA256 checksum</p>
                                <div className="ui-credential-field">
                                    <code className="break-all select-all">{desktopChecksum}</code>
                                    <button
                                        type="button"
                                        onClick={() => copy(desktopChecksum, 'desktop-checksum')}
                                        className="ui-button ghost small"
                                        aria-label="Copy desktop installer checksum"
                                    >
                                        {copied === 'desktop-checksum'
                                            ? <CheckCircle2 size={14} aria-hidden="true" />
                                            : <Copy size={14} aria-hidden="true" />}
                                        {copied === 'desktop-checksum' ? 'Copied' : 'Copy'}
                                    </button>
                                </div>
                            </div>
                        )}
                        <div className="ui-step-list ui-section-space">
                            {[
                                { step: '1', label: 'Run the installer', desc: 'Open the downloaded .exe. The preview build is unsigned, so SmartScreen asks first: choose “More info” → “Run anyway” only if you downloaded it here.' },
                                { step: '2', label: 'Read and agree', desc: 'The first screen explains what sharing means. Nothing runs until you agree.' },
                                { step: '3', label: 'Press Connect', desc: 'The app shows a short pairing code.' },
                                { step: '4', label: 'Approve it here', desc: 'Open Pair device, check the code matches, and approve this computer.' },
                                { step: '5', label: 'Sharing is on', desc: 'The app keeps your node running in the background, even after restarts if you enable it.' },
                            ].map((s) => (
                                <div key={s.step}>
                                    <div className="ui-step-number">{s.step}</div>
                                    <h3>{s.label}</h3>
                                    <p>{s.desc}</p>
                                </div>
                            ))}
                        </div>
                        <div className="ui-actions">
                            <Link href="/dashboard/provider/pair" className="ui-button secondary">
                                Pair device
                            </Link>
                            <a
                                href="https://docs.proxyhubb.com/docs/provider/app"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="ui-button secondary"
                            >
                                App guide
                            </a>
                        </div>
                    </div>
                ) : (
                    <div className="ui-page ui-section-space">
                        <p className="ui-note">
                            The in-app installer is not published on this environment yet. You can
                            still get it from the release page:
                        </p>
                        <div className="ui-actions">
                            <a
                                href={appReleasesUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={() => setDownloadStarted(true)}
                                className="ui-button"
                            >
                                <Github size={14} aria-hidden="true" />
                                Download from GitHub Releases
                            </a>
                        </div>
                    </div>
                )}
            </section>

            <section className="ui-surface">
                <div className="ui-section-heading">
                    <h2>
                        Download CLI {version !== '…' && <span className="text-muted-foreground">v{version}</span>}
                    </h2>
                </div>

                <div className="ui-tabs" role="tablist" aria-label="Operating system">
                    {PLATFORMS.map((p) => {
                        const Icon = p.icon;
                        const available = p.archs.some((a) => platformHasBuild(data?.downloads, p.id, a));
                        return (
                            <button
                                key={p.id}
                                type="button"
                                role="tab"
                                aria-selected={selectedPlatform === p.id}
                                disabled={!available && !isLoading}
                                onClick={() => {
                                    setSelectedPlatform(p.id);
                                    const arch = p.archs.find((a) => platformHasBuild(data?.downloads, p.id, a)) ?? p.archs[0];
                                    setSelectedArch(arch);
                                }}
                                className={selectedPlatform === p.id ? 'active' : ''}
                                title={available ? undefined : 'No build published for this OS yet'}
                            >
                                <span className="ui-inline-icon">
                                    <Icon size={14} aria-hidden="true" />
                                    {p.label}
                                    {!available && !isLoading && ' (unavailable)'}
                                </span>
                            </button>
                        );
                    })}
                </div>

                {platformConfig.archs.length > 1 && (
                    <div className="ui-actions ui-section-space">
                        {platformConfig.archs.map((a) => {
                            const available = platformHasBuild(data?.downloads, selectedPlatform, a);
                            return (
                                <button
                                    key={a}
                                    type="button"
                                    disabled={!available}
                                    onClick={() => setSelectedArch(a)}
                                    className={`ui-button small ${selectedArch === a ? '' : 'secondary'}`}
                                >
                                    {a}
                                </button>
                            );
                        })}
                    </div>
                )}

                {isLoading ? (
                    <Loading label="Loading available CLI downloads…" />
                ) : error ? (
                    <DataError error={error} retry={() => void refetch()} />
                ) : downloadInfo ? (
                    <div className="ui-page ui-section-space">
                        {selectedPlatform === 'windows' && (
                            <div>
                                <p className="ui-note">One-line install (recommended, no manual download)</p>
                                <CodeBlock
                                    code={oneLineInstallCmd}
                                    copied={copied === 'one-line-install'}
                                    onCopy={() => copy(oneLineInstallCmd, 'one-line-install')}
                                />
                                <p className="ui-note">
                                    Paste into PowerShell. It downloads the latest bundle over HTTPS,
                                    verifies its SHA256 checksum, and installs user-locally (no admin).
                                    Prefer to read it first?{' '}
                                    <a href={installScriptUrl} target="_blank" rel="noopener noreferrer" className="ui-link">
                                        View the installer script
                                    </a>
                                    . Afterwards run <code>provider-node pair</code> — no config files to handle by hand.
                                </p>
                            </div>
                        )}

                        <ManualDownloadWrap collapsed={selectedPlatform === 'windows'}>
                        <div className="ui-row">
                            <div className="ui-row-identity">
                                <span className="ui-region">
                                    <Server size={16} aria-hidden="true" />
                                </span>
                                <div>
                                    <h3>{downloadInfo.filename}</h3>
                                    <p>
                                        {(downloadInfo.file_size / 1024 / 1024).toFixed(1)} MB · v{downloadInfo.version} · {packageType}
                                    </p>
                                </div>
                            </div>
                            <a
                                href={getCLIDownloadUrl(selectedPlatform, selectedArch, downloadInfo.version, packageType)}
                                download={downloadInfo.filename}
                                onClick={handleDownloadClick}
                                className="ui-button"
                            >
                                <Download size={14} aria-hidden="true" />
                                Download
                            </a>
                        </div>

                        {checksum && (
                            <div>
                                <p className="ui-note">SHA256 checksum</p>
                                <div className="ui-credential-field">
                                    <code className="break-all select-all">{checksum}</code>
                                    <button
                                        type="button"
                                        onClick={() => copy(checksum, 'checksum')}
                                        className="ui-button ghost small"
                                        aria-label="Copy SHA256 checksum"
                                    >
                                        {copied === 'checksum'
                                            ? <CheckCircle2 size={14} aria-hidden="true" />
                                            : <Copy size={14} aria-hidden="true" />}
                                        {copied === 'checksum' ? 'Copied' : 'Copy'}
                                    </button>
                                </div>
                                <CodeBlock
                                    code={verifyChecksumCmd}
                                    copied={copied === 'verify-checksum'}
                                    onCopy={() => copy(verifyChecksumCmd, 'verify-checksum')}
                                />
                            </div>
                        )}

                        <p className="ui-note">
                            Prefer a zip with launcher?{' '}
                            <a href={releasesUrl} target="_blank" rel="noopener noreferrer" className="ui-link">
                                GitHub Releases (provider-v*)
                            </a>
                            {selectedPlatform === 'windows' && ' includes Launch-Provider-Console.cmd'}
                            .
                        </p>
                        </ManualDownloadWrap>
                    </div>
                ) : (
                    <EmptyState
                        title="No in-app build for this platform yet"
                        description={`There is no in-app build for ${selectedPlatform}/${selectedArch} on this environment yet. Download a published release from GitHub instead.`}
                    />
                )}
                {!isLoading && !error && !downloadInfo && (
                    <div className="ui-actions">
                        <a
                            href={releasesUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => setDownloadStarted(true)}
                            className="ui-button"
                        >
                            <Github size={14} aria-hidden="true" />
                            Download from GitHub Releases
                        </a>
                    </div>
                )}
            </section>

            {(downloadStarted || downloadInfo) && (
                <section className="ui-surface">
                    <div id="cli-next-steps" className="scroll-mt-24">
                        <div className="ui-section-heading">
                            <h2>
                                {downloadStarted ? 'Download started. Open your console' : 'Open the interactive console'}
                            </h2>
                        </div>
                        <p className="ui-note">
                            The binary is a console app, not a silent installer. Running it with no arguments keeps a window open
                            with a menu (dashboard, doctor, start). Already installed? Run{' '}
                            <code>provider-node update</code> to replace the binary in place:
                            no need to delete the old download first.
                        </p>
                        <CodeBlock
                            code={openConsoleCmd}
                            copied={copied === 'open-console'}
                            onCopy={() => copy(openConsoleCmd, 'open-console')}
                        />
                    </div>
                </section>
            )}

            <section className="ui-surface">
                <div className="ui-section-heading">
                    <h2 className="ui-inline-icon">
                        <Activity size={16} aria-hidden="true" />
                        Operator console
                    </h2>
                    <button
                        type="button"
                        onClick={() => refetchNodes()}
                        className="ui-button secondary small"
                    >
                        Refresh
                    </button>
                </div>
                <p className="ui-note">
                    Live view of your provider nodes from Control API. After the daemon heartbeats, status should flip online here.
                </p>
                {nodesLoading && !nodesData ? (
                    <Loading label="Loading your provider nodes…" />
                ) : nodesError && !nodesData ? (
                    <DataError error={nodesError} retry={() => void refetchNodes()} />
                ) : nodes.length === 0 ? (
                    <EmptyState
                        title="No provider nodes yet"
                        description="Finish the Setup wizard, start the daemon from the console menu, then refresh this list."
                        href="/dashboard/provider/setup"
                        action="Open setup wizard"
                    />
                ) : (
                    <div>
                        <p className="ui-note">
                            {onlineCount}/{nodes.length} online
                            {dataUpdatedAt ? ` · updated ${new Date(dataUpdatedAt).toLocaleTimeString()}` : ''}
                        </p>
                        <div className="ui-table-wrap ui-section-space" role="region" aria-label="Provider nodes" tabIndex={0}>
                            <table className="ui-table">
                                <thead>
                                    <tr>
                                        <th>Node</th>
                                        <th>Location</th>
                                        <th>Type</th>
                                        <th>Latency</th>
                                        <th>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {nodes.map((node) => {
                                        const online = /online|active|healthy/i.test(node.status);
                                        return (
                                            <tr key={node.id}>
                                                <td>{node.name || node.id}</td>
                                                <td>{node.country || 'Unknown'}</td>
                                                <td>{node.connection_type || 'node'}</td>
                                                <td>{node.latency_ms != null ? `${node.latency_ms}ms` : 'latency n/a'}</td>
                                                <td>
                                                    <Status tone={online ? 'good' : 'warning'}>
                                                        {node.status}
                                                    </Status>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </section>

            {downloadInfo && (
                <section className="ui-surface">
                    <div className="ui-section-heading">
                        <h2>Quick start</h2>
                    </div>
                    <p className="ui-note">
                        Prefer <Link href="/dashboard/provider/setup" className="ui-link">Setup</Link>
                        {' '}→ download config → <code>start</code>.
                        Running <code>register</code> after the wizard creates a second orphan node.
                        No config file? Run <code>provider-node pair</code> and approve the code{' '}
                        <Link href="/dashboard/provider/pair" className="ui-link">here</Link> instead.
                    </p>
                    <CodeBlock
                        code={installCmd}
                        copied={copied === 'install'}
                        onCopy={() => copy(installCmd, 'install')}
                    />
                    <div className="ui-step-list ui-section-space">
                        {steps.map((s) => (
                            <div key={s.step}>
                                <div className="ui-step-number">{s.step}</div>
                                <h3>{s.label}</h3>
                                <p>{s.desc}</p>
                            </div>
                        ))}
                    </div>
                    <div className="ui-section-space">
                        <h3>CLI-only path (new node; skip if you used Setup)</h3>
                        <p className="ui-note">
                            Create a token under{' '}
                            <Link href="/dashboard/provider/tokens" className="ui-link">API tokens</Link>
                            , then:
                        </p>
                        <CodeBlock
                            code={registerOnlyCmd}
                            copied={copied === 'register-only'}
                            onCopy={() => copy(registerOnlyCmd, 'register-only')}
                        />
                    </div>
                </section>
            )}

            <section className="ui-surface">
                <div className="ui-section-heading">
                    <h2>Local dev sequence</h2>
                </div>
                <p className="ui-note">
                    Local stack only (Control API :18080, Gateway :3128). Production uses the URLs above.
                </p>
                <CodeBlock
                    code={localWorkspaceCmd}
                    copied={copied === 'local-sequence'}
                    onCopy={() => copy(localWorkspaceCmd, 'local-sequence')}
                />
            </section>

            <section className="ui-surface">
                <div className="ui-section-heading">
                    <h2>Config template</h2>
                </div>
                <p className="ui-note">
                    Save as <code>provider.toml</code> at{' '}
                    <code>{configPath}</code>. Prefer My nodes → Connect for a filled file.
                </p>
                <div className="ui-note">
                    <p>Auth split:</p>
                    <p>
                        <code>api_key</code>: long-lived provider token from dashboard.
                    </p>
                    <p>
                        <code>jwt_token</code>: leave empty (auto-refreshed from api_key).
                    </p>
                    <p>
                        <code>provider_signing_key</code>: heartbeat hotkey. If your profile wallet is linked, prefer signing with that wallet rather than a random browser key.
                    </p>
                </div>
                <CodeBlock
                    code={configTemplate}
                    copied={copied === 'config'}
                    onCopy={() => copy(configTemplate, 'config')}
                />
            </section>

            <section className="ui-surface">
                <div className="ui-section-heading">
                    <h2>Common commands</h2>
                </div>
                <div>
                    {[
                        { cmd: `${exe}`, desc: 'Interactive console menu (no args)' },
                        { cmd: `${exe} doctor ${cfg}`, desc: 'Pre-flight checks' },
                        { cmd: `${exe} start ${cfg}`, desc: 'Start daemon (preferred after Setup / Connect)' },
                        { cmd: `${exe} dashboard ${cfg}`, desc: 'Live TUI window' },
                        { cmd: `${exe} service install ${cfg}`, desc: 'Optional: start automatically at sign-in' },
                        { cmd: `${exe} service start`, desc: 'Optional: start installed service' },
                        { cmd: `${exe} status --json`, desc: 'Machine-readable status' },
                        { cmd: `${exe} register --api-url ${endpoints.controlApiUrl} --api-key <PROVIDER_TOKEN>`, desc: 'CLI-only: creates a NEW node (skip after wizard)' },
                        { cmd: `proxyhubb-cli join --api-url ${endpoints.controlApiUrl} --key <TOKEN> --gateway ${endpoints.gatewayTunnelAddr}`, desc: 'Onboarding wrapper' },
                    ].map(({ cmd, desc }) => (
                        <div key={cmd} className="ui-row">
                            <div>
                                <h3><code className="ui-truncate-id" title={cmd}>{cmd}</code></h3>
                                <p>{desc}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => copy(cmd, cmd)}
                                className="ui-button ghost small"
                            >
                                {copied === cmd
                                    ? <CheckCircle2 size={14} aria-hidden="true" />
                                    : <Copy size={14} aria-hidden="true" />}
                                {copied === cmd ? 'Copied' : 'Copy'}
                            </button>
                        </div>
                    ))}
                </div>
            </section>

            <div className="ui-actions">
                <Link
                    href="/dashboard/provider/setup"
                    className="ui-button"
                >
                    Setup wizard
                </Link>
                <Link
                    href="/dashboard/provider/tokens"
                    className="ui-button secondary"
                >
                    API tokens
                </Link>
            </div>
        </div>
    );
}

function CodeBlock({
    code, copied, onCopy,
}: {
    code: string;
    copied: boolean;
    onCopy: () => void;
}) {
    return (
        <div className="relative">
            <pre className="ui-code pr-16">{code}</pre>
            <button
                type="button"
                onClick={onCopy}
                className="ui-button ghost small absolute top-3 right-3"
            >
                {copied ? <CheckCircle2 size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                {copied ? 'Copied' : 'Copy'}
            </button>
        </div>
    );
}
