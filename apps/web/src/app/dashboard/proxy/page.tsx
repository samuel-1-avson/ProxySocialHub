"use client";

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createSessionIntent, getSessionIntentStatus, getSessions, getAnalyticsOverview } from '@/lib/api';
import type { Session, CreateSessionIntentResponse, SessionIntentLifecycle } from '@/lib/api';
import {
    Globe,
    Shield,
    Copy,
    Wifi,
    WifiOff,
    Activity,
    Zap,
    CheckCircle,
    RefreshCw,
    Lock,
} from 'lucide-react';
import Link from 'next/link';
import { getBuyerProxyEndpoint } from '@/lib/proxy-endpoint';
import {
    PageHeading,
    Loading,
    DataError,
    EmptyState,
    Stat,
    Status,
    amount,
} from '@/components/workspace/Patterns';

const PROXY_ENDPOINT = getBuyerProxyEndpoint();
const SDK_MATRIX = [
    {
        id: 'python',
        name: 'Python',
        icon: 'Py',
        bg: 'hover:bg-info/10',
        install: 'pip install proxyhubb',
        docs: 'https://docs.proxyhubb.com/docs/sdks/python',
        registry: 'https://pypi.org/project/proxyhubb/',
    },
    {
        id: 'nodejs',
        name: 'Node.js',
        icon: 'JS',
        bg: 'hover:bg-success/10',
        install: 'npm install @proxyhubb/sdk',
        docs: 'https://docs.proxyhubb.com/docs/sdks/nodejs',
        registry: 'https://www.npmjs.com/package/@proxyhubb/sdk',
    },
    {
        id: 'golang',
        name: 'Golang',
        icon: 'Go',
        bg: 'hover:bg-info/10',
        install: 'go get github.com/samuel-1-avson/ProxySocialHub/sdks/go@v0.2.0',
        docs: 'https://docs.proxyhubb.com/docs/sdks/go',
        registry: 'https://pkg.go.dev/github.com/samuel-1-avson/ProxySocialHub/sdks/go',
    },
    {
        id: 'rest',
        name: 'Rest API',
        icon: 'API',
        bg: 'hover:bg-primary/10',
        install: 'GET https://api.proxyhubb.com/v1/sdks/languages',
        docs: 'https://docs.proxyhubb.com/docs/api',
        registry: 'https://docs.proxyhubb.com/openapi.yaml',
    },
] as const;
const terminalIntentStates = new Set<SessionIntentLifecycle>([
    'ledger_committed',
    'batched',
    'chain_committed',
    'archived',
    'expired',
]);

function formatIntentLifecycleLabel(state: SessionIntentLifecycle) {
    return state.replace(/_/g, ' ');
}

function isTerminalIntentLifecycle(state: SessionIntentLifecycle | 'idle' | 'requesting') {
    return terminalIntentStates.has(state as SessionIntentLifecycle);
}

export default function ProxyPage() {
    const [creating, setCreating] = useState(false);
    const [testing, setTesting] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'online' | 'offline'>('idle');
    const [copied, setCopied] = useState<string | null>(null);
    const [selectedTier, setSelectedTier] = useState<string>('any');
    const [sessionIntent, setSessionIntent] = useState<CreateSessionIntentResponse | null>(null);
    const [intentLifecycle, setIntentLifecycle] = useState<'idle' | 'requesting' | SessionIntentLifecycle>('idle');
    const [sdkGuide, setSdkGuide] = useState<(typeof SDK_MATRIX)[number]['id'] | null>(null);

    const tiers = [
        { id: 'any', name: 'Any Tier', icon: Globe, color: 'text-muted-foreground', border: 'border-border', bg: 'bg-muted' },
        { id: 'Bronze', name: 'Bronze', icon: Shield, color: 'text-warning', border: 'border-warning/20', bg: 'bg-warning/10' },
        { id: 'Silver', name: 'Silver', icon: CheckCircle, color: 'text-muted-foreground', border: 'border-border', bg: 'bg-muted/10' },
        { id: 'Gold', name: 'Gold', icon: Zap, color: 'text-warning dark:text-warning', border: 'border-warning/20', bg: 'bg-warning/10' },
    ];

    const { data: allSessions = [], isLoading: loading, isError: sessionsError, error: sessionsQueryError, refetch: refetchSessions } = useQuery({
        queryKey: ['sessions'],
        queryFn: getSessions,
        refetchInterval: 15000,
        retry: 2,
    });

    const { data: analytics, isLoading: analyticsLoading, isError: analyticsError, error: analyticsQueryError, refetch: refetchAnalytics } = useQuery({
        queryKey: ['analytics-overview'],
        queryFn: getAnalyticsOverview,
        refetchInterval: 30000,
        retry: 2,
    });

    const { data: persistedIntentStatus } = useQuery({
        queryKey: ['session-intent-status', sessionIntent?.intent.intent_id],
        queryFn: () => getSessionIntentStatus(sessionIntent!.intent.intent_id),
        enabled: !!sessionIntent?.intent.intent_id,
        refetchInterval: sessionIntent && !isTerminalIntentLifecycle(intentLifecycle) ? 5000 : false,
        retry: 1,
    });

    const sessions = allSessions.filter((s: Session) => s.status === 'active');

    async function handleQuickStart(type: 'rotating' | 'sticky') {
        setCreating(true);
        setIntentLifecycle('requesting');
        try {
            const intent = await createSessionIntent({
                type,
                preferred_tier: selectedTier === 'any' ? undefined : selectedTier,
            });
            setSessionIntent(intent);
            setIntentLifecycle(intent.lifecycle_state);

            if (intent.token) {
                const curlCmd = `curl -x session-intent:${encodeURIComponent(intent.token)}@${PROXY_ENDPOINT} https://httpbin.org/ip`;
                navigator.clipboard.writeText(curlCmd);
                setCopied('intent-curl');
                setTimeout(() => setCopied(null), 3000);
            }
        } catch (error) {
            console.error('Failed to create session:', error);
            setIntentLifecycle('idle');
        } finally {
            setCreating(false);
        }
    }

    useEffect(() => {
        if (!persistedIntentStatus) {
            return;
        }
        setIntentLifecycle(persistedIntentStatus.lifecycle_state);
        setSessionIntent((current) => {
            if (!current || current.intent.intent_id !== persistedIntentStatus.intent.intent_id) {
                return current;
            }
            return {
                ...current,
                expires_at: persistedIntentStatus.expires_at,
                lifecycle_state: persistedIntentStatus.lifecycle_state,
                intent: {
                    ...current.intent,
                    ...persistedIntentStatus.intent,
                },
            };
        });
    }, [persistedIntentStatus]);

    async function testConnection() {
        setTesting(true);
        setConnectionStatus('testing');
        try {
            const response = await fetch('/api/proxy/test');
            if (response.ok) {
                setConnectionStatus('online');
            } else {
                setConnectionStatus('offline');
            }
        } catch {
            setConnectionStatus('offline');
        } finally {
            setTesting(false);
        }
    }

    function copyToClipboard(text: string, label: string) {
        navigator.clipboard.writeText(text);
        setCopied(label);
        setTimeout(() => setCopied(null), 3000);
    }

    const activeSession = sessions[0];
    const activeIntent = sessionIntent && !terminalIntentStates.has(sessionIntent.lifecycle_state) ? sessionIntent : null;
    const liveIdentifier = activeIntent
        ? activeIntent.intent.intent_id
        : activeSession?.id ?? '';
    const liveProtocol = activeIntent
        ? activeIntent.intent.session_type.toUpperCase()
        : activeSession?.type.toUpperCase() ?? 'UNKNOWN';
    const liveCurlCopy = activeIntent
        ? `curl -x session-intent:${encodeURIComponent(activeIntent.token)}@${PROXY_ENDPOINT} https://httpbin.org/ip`
        : `curl -x user:pass@${PROXY_ENDPOINT} https://httpbin.org/ip`;
    const liveCurlDisplay = activeIntent
        ? `curl -x session-intent:<intent-token>@${PROXY_ENDPOINT} https://httpbin.org/ip`
        : `curl -x ${activeSession?.id.substring(0, 8) ?? 'user'}:********@${PROXY_ENDPOINT} https://httpbin.org/ip`;
    const liveNodeCopy = activeIntent
        ? `const axios = require('axios');\nconst proxy = 'http://session-intent:${activeIntent.token}@${PROXY_ENDPOINT}';\naxios.get('https://httpbin.org/ip', { proxy }).then(res => console.log(res.data));`
        : `const axios = require('axios');\nconst proxy = 'http://user:pass@${PROXY_ENDPOINT}';\naxios.get('https://httpbin.org/ip', { proxy }).then(res => console.log(res.data));`;
    const liveNodeDisplay = activeIntent
        ? `const axios = require('axios');\nconst proxy = 'http://session-intent:<intent-token>@${PROXY_ENDPOINT}';\naxios.get('https://...', { proxy });`
        : `const axios = require('axios');\nconst proxy = 'http://${activeSession?.id.substring(0, 8) ?? 'user'}:***@${PROXY_ENDPOINT}';\naxios.get('https://...', { proxy });`;

    if (loading) {
        return (
            <div className="ui-page">
                <PageHeading
                    eyebrow="Buyer workspace"
                    title="Proxy gateway"
                    description="Secure interface for distributed residential proxy networks."
                />
                <Loading label="Loading your proxy sessions…" />
            </div>
        );
    }

    return (
        <div className="ui-page">
            <PageHeading
                eyebrow="Buyer workspace"
                title="Proxy gateway"
                description="Secure interface for distributed residential proxy networks."
                actions={
                    <button
                        type="button"
                        onClick={testConnection}
                        disabled={testing}
                        className="ui-button secondary"
                    >
                        {testing ? 'Scanning…' : 'Scan connection'}
                    </button>
                }
            />

            {sessionsError && (
                <DataError error={sessionsQueryError} retry={() => void refetchSessions()} />
            )}

            <section className="ui-stats">
                <div>
                    <div className="ui-stat-label">Gateway endpoint</div>
                    <div className="ui-stat-value text-[18px] break-all">{PROXY_ENDPOINT}</div>
                    <div className="ui-stat-detail">HTTP CONNECT / SOCKS5 only. See docs/buyer-proxy.md</div>
                    <button
                        type="button"
                        onClick={() => copyToClipboard(PROXY_ENDPOINT, 'endpoint')}
                        className="ui-button ghost small mt-2"
                    >
                        {copied === 'endpoint' ? <CheckCircle size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                        {copied === 'endpoint' ? 'Copied' : 'Copy endpoint'}
                    </button>
                </div>
                <div>
                    <div className="ui-stat-label">Signal integrity</div>
                    {connectionStatus === 'online' && (
                        <>
                            <div className="ui-stat-value ui-inline-icon">
                                <Wifi size={20} aria-hidden="true" /> Synchronized
                            </div>
                            <div className="ui-stat-detail">Minimal jitter detected</div>
                        </>
                    )}
                    {connectionStatus === 'offline' && (
                        <>
                            <div className="ui-stat-value ui-inline-icon">
                                <WifiOff size={20} aria-hidden="true" /> Connection lost
                            </div>
                            <div className="ui-stat-detail">The connection test did not succeed</div>
                        </>
                    )}
                    {connectionStatus === 'testing' && (
                        <>
                            <div className="ui-stat-value">Probing…</div>
                            <div className="ui-stat-detail">Checking gateway reachability</div>
                        </>
                    )}
                    {connectionStatus === 'idle' && (
                        <>
                            <div className="ui-stat-value ui-inline-icon">
                                <Activity size={20} aria-hidden="true" /> Standby
                            </div>
                            <div className="ui-stat-detail">Run a connection scan to verify the gateway</div>
                        </>
                    )}
                </div>
                <div>
                    <div className="ui-stat-label">Active channels</div>
                    <div className="ui-stat-value">{sessions.length + (activeIntent ? 1 : 0)}</div>
                    <div className="ui-stat-detail">
                        <Link href="/dashboard/sessions" className="ui-link">Manage streams</Link>
                    </div>
                </div>
            </section>

            {sessionIntent && (
                <section className="ui-surface">
                    <div className="ui-section-heading">
                        <h2>V2 session intent</h2>
                        <Status tone="good">
                            {formatIntentLifecycleLabel(persistedIntentStatus?.lifecycle_state ?? sessionIntent.lifecycle_state)}
                        </Status>
                    </div>
                    <code className="ui-code">{sessionIntent.token}</code>
                    <p className="ui-note">
                        State: {formatIntentLifecycleLabel(persistedIntentStatus?.lifecycle_state ?? sessionIntent.lifecycle_state)} · Expires: {new Date((persistedIntentStatus?.expires_at ?? sessionIntent.expires_at)).toLocaleTimeString()}
                    </p>
                    <div className="ui-actions">
                        <button
                            type="button"
                            onClick={() => copyToClipboard(sessionIntent.token, 'intent-token')}
                            className="ui-button secondary"
                        >
                            {copied === 'intent-token' ? 'Copied' : 'Copy intent token'}
                        </button>
                        <button
                            type="button"
                            onClick={() => copyToClipboard(`curl -x session-intent:${encodeURIComponent(sessionIntent.token)}@${PROXY_ENDPOINT} https://httpbin.org/ip`, 'intent-curl')}
                            className="ui-button secondary"
                        >
                            {copied === 'intent-curl' ? 'Copied' : 'Copy V2 cURL'}
                        </button>
                    </div>
                </section>
            )}

            {!activeSession && !activeIntent && (
                <section className="ui-surface">
                    <div className="ui-section-heading">
                        <h2>Select deployment tier</h2>
                    </div>
                    <div className="ui-tabs" role="tablist" aria-label="Deployment tier">
                        {tiers.map((tier) => (
                            <button
                                key={tier.id}
                                type="button"
                                role="tab"
                                aria-selected={selectedTier === tier.id}
                                onClick={() => setSelectedTier(tier.id)}
                                className={selectedTier === tier.id ? 'active' : ''}
                            >
                                {tier.name}
                                {tier.id === 'Gold' ? ' · Premium QoS' : ''}
                            </button>
                        ))}
                    </div>
                </section>
            )}

            <section>
                <div className="ui-section-heading">
                    <h2>
                        {sessions.length === 0 ? 'Create your first session' : 'Your active sessions'}
                    </h2>
                </div>

                {sessions.length === 0 && (
                    <EmptyState
                        title="Ready to connect?"
                        description="You don't have any active proxy sessions yet. Create one below to start browsing securely through our decentralized proxy network."
                    />
                )}
                {sessions.length === 0 && (
                    <p className="ui-note">
                        Residential IPs · 150+ countries · Pay per GB
                    </p>
                )}

                {activeIntent || activeSession ? (
                    <section className="ui-surface">
                        <div className="ui-section-heading">
                            <h2>{activeIntent ? 'Intent authorized' : 'Session authorized'}</h2>
                            <Status tone="good">
                                Protocol: {liveProtocol}
                            </Status>
                        </div>
                        <p className="ui-note">ID: {liveIdentifier}</p>
                        <div className="ui-form-grid">
                            <div>
                                <div className="ui-section-heading">
                                    <h3>cURL intercept</h3>
                                    <button
                                        type="button"
                                        onClick={() => copyToClipboard(liveCurlCopy, activeIntent ? 'intent-curl' : 'curl')}
                                        className="ui-button ghost small"
                                    >
                                        {copied === 'curl' || copied === 'intent-curl' ? 'Copied' : 'Copy payload'}
                                    </button>
                                </div>
                                <pre className="ui-code">{liveCurlDisplay}</pre>
                            </div>
                            <div>
                                <div className="ui-section-heading">
                                    <h3>Node.js fragment</h3>
                                    <button
                                        type="button"
                                        onClick={() => copyToClipboard(liveNodeCopy, 'node')}
                                        className="ui-button ghost small"
                                    >
                                        {copied === 'node' ? 'Copied' : 'Copy payload'}
                                    </button>
                                </div>
                                <pre className="ui-code">{liveNodeDisplay}</pre>
                            </div>
                        </div>
                    </section>
                ) : (
                    <div className="ui-columns">
                        <button
                            type="button"
                            onClick={() => handleQuickStart('rotating')}
                            disabled={creating}
                            className="ui-surface text-left"
                        >
                            <span className="ui-region mb-3">
                                {creating ? '…' : <RefreshCw size={18} aria-hidden="true" />}
                            </span>
                            <h2>Rotating stream</h2>
                            <p className="ui-note">
                                New identity per request. Ideal for aggressive data harvesting and anonymized discovery.
                            </p>
                        </button>
                        <button
                            type="button"
                            onClick={() => handleQuickStart('sticky')}
                            disabled={creating}
                            className="ui-surface text-left"
                        >
                            <span className="ui-region mb-3">
                                {creating ? '…' : <Lock size={18} aria-hidden="true" />}
                            </span>
                            <h2>Sticky core</h2>
                            <p className="ui-note">
                                Persistent identity fragments. Perfect for secure account simulation and linear sessions.
                            </p>
                        </button>
                    </div>
                )}
            </section>

            <section className="ui-surface">
                <div className="ui-section-heading">
                    <h2>Real-time telemetry</h2>
                    <Link href="/dashboard/usage" className="ui-link">
                        Analytics vault
                    </Link>
                </div>

                {analyticsError && (
                    <DataError error={analyticsQueryError} retry={() => void refetchAnalytics()} />
                )}

                {sessions.length === 0 ? (
                    <EmptyState
                        title="No telemetry data yet"
                        description="Create a session above to start tracking your proxy usage."
                    />
                ) : (
                    <section className="ui-stats">
                        <Stat
                            label="Requests today"
                            value={analyticsLoading ? '…' : analytics?.total_requests?.toLocaleString() || '0'}
                            detail="From analytics overview"
                        />
                        <Stat
                            label="Data pipeline"
                            value={analyticsLoading ? '…' : `${amount(analytics?.total_bandwidth_gb ?? 0, 2)} GB`}
                            detail="Reported bandwidth"
                        />
                        <Stat
                            label="Avg latency"
                            value={analyticsLoading ? '…' : `${analytics?.avg_latency_ms || '0'}ms`}
                            detail="Across observed requests"
                        />
                    </section>
                )}
                {sessions.length > 0 && (
                    <p className="ui-note">
                        Success rate: {analyticsLoading ? '…' : `${analytics?.success_rate || '0'}%`}
                    </p>
                )}
            </section>

            <section className="ui-surface">
                <div className="ui-section-heading">
                    <h2>Integration matrices</h2>
                </div>
                <p className="ui-note">
                    Official SDKs for Connect session intents and marketplace credentials. Install a client, then use the quick-start snippets above.
                </p>
                <div className="ui-tabs" role="tablist" aria-label="SDK guides">
                    {SDK_MATRIX.map((guide) => (
                        <button
                            key={guide.id}
                            type="button"
                            onClick={() => setSdkGuide((prev) => (prev === guide.id ? null : guide.id))}
                            className={sdkGuide === guide.id ? 'active' : ''}
                        >
                            {guide.name}
                        </button>
                    ))}
                </div>
                {sdkGuide && (() => {
                    const selected = SDK_MATRIX.find((g) => g.id === sdkGuide);
                    if (!selected) return null;
                    return (
                        <div className="ui-section-space">
                            <div className="ui-section-heading">
                                <h3>{selected.name}</h3>
                                <div className="ui-actions">
                                    <a
                                        href={selected.docs}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="ui-link"
                                    >
                                        Docs
                                    </a>
                                    <a
                                        href={selected.registry}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="ui-link"
                                    >
                                        Registry
                                    </a>
                                </div>
                            </div>
                            <div className="ui-credential-field">
                                <code>{selected.install}</code>
                                <button
                                    type="button"
                                    onClick={() => copyToClipboard(selected.install, `sdk-${selected.id}`)}
                                    className="ui-button ghost small"
                                    aria-label="Copy install command"
                                >
                                    {copied === `sdk-${selected.id}` ? 'Copied' : 'Copy'}
                                </button>
                            </div>
                        </div>
                    );
                })()}
            </section>
        </div>
    );
}
