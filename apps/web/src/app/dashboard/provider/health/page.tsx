'use client';

import { useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
    CheckCircle2, XCircle, AlertCircle,
    Loader2, Wifi, Clock, BarChart3, Cpu, MapPin
} from 'lucide-react';
import { getMyNodes, getNodeUptime } from '@/lib/api/provider';
import {
    PageHeading,
    Loading,
    DataError,
    EmptyState,
    Status,
} from '@/components/workspace/Patterns';

type CheckStatus = 'pass' | 'warn' | 'fail' | 'loading';

interface HealthCheck {
    id: string;
    label: string;
    description: string;
    status: CheckStatus;
    detail?: string;
}

function checkTone(status: CheckStatus): 'good' | 'warning' | 'error' | 'neutral' {
    if (status === 'pass') return 'good';
    if (status === 'warn') return 'warning';
    if (status === 'fail') return 'error';
    return 'neutral';
}

function StatusIcon({ status }: { status: CheckStatus }) {
    if (status === 'loading') return <Loader2 size={16} className="animate-spin text-muted-foreground" aria-hidden="true" />;
    if (status === 'pass') return <CheckCircle2 size={16} aria-hidden="true" />;
    if (status === 'warn') return <AlertCircle size={16} aria-hidden="true" />;
    return <XCircle size={16} aria-hidden="true" />;
}

function overallLabel(status: CheckStatus) {
    if (status === 'loading') return 'Running checks…';
    if (status === 'pass') return 'All systems healthy';
    if (status === 'warn') return 'Some checks need attention';
    return 'Critical issues detected';
}

export default function HealthPage() {
    const [refreshKey, setRefreshKey] = useState(0);

    const { data: nodesData, isLoading: nodesLoading, isError: nodesError, error: nodesQueryError, refetch: refetchNodes } = useQuery({
        queryKey: ['my-nodes', refreshKey],
        queryFn: getMyNodes,
    });

    const nodes = nodesData?.nodes ?? [];
    const onlineNodes = nodes.filter((n) => n.status === 'online');
    const offlineNodes = nodes.filter((n) => n.status === 'offline' || n.status === 'pending');

    const uptimeQueries = useQueries({
        queries: nodes.slice(0, 8).map((node) => ({
            queryKey: ['node-uptime', node.id, refreshKey],
            queryFn: () => getNodeUptime(node.id),
            staleTime: 60_000,
            enabled: nodes.length > 0,
        })),
    });

    const uptimeByNode = useMemo(() => {
        const map = new Map<string, { uptime_percent: number; checks_24h: number; avg_latency_ms: number }>();
        nodes.slice(0, 8).forEach((node, i) => {
            const data = uptimeQueries[i]?.data;
            if (data) {
                map.set(node.id, {
                    uptime_percent: data.uptime_percent,
                    checks_24h: data.checks_24h,
                    avg_latency_ms: data.avg_latency_ms,
                });
            }
        });
        return map;
    }, [nodes, uptimeQueries]);

    const avgApiUptime = useMemo(() => {
        const vals = [...uptimeByNode.values()].map((v) => v.uptime_percent).filter((n) => n > 0);
        if (vals.length === 0) return null;
        return vals.reduce((a, b) => a + b, 0) / vals.length;
    }, [uptimeByNode]);

    const avgUptime = avgApiUptime ?? (nodes.length > 0
        ? nodes.reduce((s, n) => s + (n.uptime_percent ?? 0), 0) / nodes.length
        : null);
    const avgLatency = onlineNodes.length > 0
        ? onlineNodes.reduce((s, n) => s + (n.latency_ms ?? 0), 0) / onlineNodes.length
        : null;
    const avgScore = nodes.length > 0
        ? nodes.reduce((s, n) => s + (n.quality_score ?? 0), 0) / nodes.length
        : null;
    const proofOk = nodes.filter((n) => n.latest_heartbeat_verified).length;
    const withWallet = nodes.filter((n) => Boolean(n.wallet_address)).length;

    const checks: HealthCheck[] = nodesLoading
        ? [
            { id: 'nodes', label: 'Node Registration', description: 'Checking registered nodes…', status: 'loading' },
            { id: 'connectivity', label: 'Connectivity', description: 'Checking online status…', status: 'loading' },
            { id: 'uptime', label: 'Uptime (24h)', description: 'Checking uptime history…', status: 'loading' },
            { id: 'proof', label: 'Heartbeat proof', description: 'Checking signed heartbeats…', status: 'loading' },
            { id: 'payout', label: 'Payout wallet', description: 'Checking node payout wallets…', status: 'loading' },
            { id: 'latency', label: 'Latency', description: 'Checking response times…', status: 'loading' },
        ]
        : [
            {
                id: 'nodes',
                label: 'Node Registration',
                description: 'At least one node registered',
                status: nodes.length > 0 ? 'pass' : 'fail',
                detail: nodes.length === 0
                    ? 'No nodes registered. Use the setup wizard.'
                    : `${nodes.length} node${nodes.length > 1 ? 's' : ''} registered`,
            },
            {
                id: 'connectivity',
                label: 'Connectivity',
                description: 'Nodes online via CLI tunnel',
                status: nodes.length === 0
                    ? 'fail'
                    : onlineNodes.length === nodes.length
                    ? 'pass'
                    : onlineNodes.length > 0
                    ? 'warn'
                    : 'fail',
                detail: nodes.length === 0
                    ? 'No nodes to check'
                    : `${onlineNodes.length} of ${nodes.length} online${offlineNodes.length > 0 ? ` · ${offlineNodes.length} offline/pending` : ''}`,
            },
            {
                id: 'uptime',
                label: 'Uptime (24h API)',
                description: 'Average uptime above 90%',
                status: avgUptime === null
                    ? 'warn'
                    : avgUptime >= 95
                    ? 'pass'
                    : avgUptime >= 80
                    ? 'warn'
                    : 'fail',
                detail: avgUptime !== null
                    ? `Average uptime: ${avgUptime.toFixed(1)}%${avgApiUptime != null ? ' (from /uptime)' : ''}`
                    : 'No uptime history yet',
            },
            {
                id: 'proof',
                label: 'Heartbeat proof',
                description: 'Signed heartbeats verified',
                status: nodes.length === 0
                    ? 'fail'
                    : proofOk === nodes.length
                    ? 'pass'
                    : proofOk > 0
                    ? 'warn'
                    : 'warn',
                detail: nodes.length === 0
                    ? 'No nodes'
                    : `${proofOk}/${nodes.length} nodes with verified proof`,
            },
            {
                id: 'payout',
                label: 'Payout wallet',
                description: 'Node has Solana payout wallet for claims',
                status: nodes.length === 0
                    ? 'fail'
                    : withWallet === nodes.length
                    ? 'pass'
                    : withWallet > 0
                    ? 'warn'
                    : 'fail',
                detail: nodes.length === 0
                    ? 'No nodes'
                    : `${withWallet}/${nodes.length} nodes have payout wallet (linked from profile)`,
            },
            {
                id: 'latency',
                label: 'Latency',
                description: 'Average response time below 200ms',
                status: avgLatency === null
                    ? onlineNodes.length === 0 ? 'warn' : 'fail'
                    : avgLatency < 100
                    ? 'pass'
                    : avgLatency < 200
                    ? 'warn'
                    : 'fail',
                detail: avgLatency !== null
                    ? `Average latency: ${avgLatency.toFixed(0)}ms`
                    : onlineNodes.length === 0
                    ? 'No online nodes to measure'
                    : 'No latency data',
            },
        ];

    const passing = checks.filter((c) => c.status === 'pass').length;
    const failing = checks.filter((c) => c.status === 'fail').length;
    const warning = checks.filter((c) => c.status === 'warn').length;
    const overall: CheckStatus = failing > 0 ? 'fail' : warning > 0 ? 'warn' : nodesLoading ? 'loading' : 'pass';

    return (
        <div className="ui-page">
            <PageHeading
                eyebrow="Diagnostics"
                title="Node health"
                description="Connectivity, uptime history, heartbeat proofs, and payout readiness."
                actions={
                    <button
                        type="button"
                        onClick={() => setRefreshKey((k) => k + 1)}
                        className="ui-button secondary"
                    >
                        Refresh
                    </button>
                }
            />

            {nodesError && (
                <DataError
                    error={nodesQueryError}
                    retry={() => {
                        setRefreshKey((k) => k + 1);
                        void refetchNodes();
                    }}
                />
            )}

            {nodesLoading && <Loading label="Checking node health…" />}

            {!nodesLoading && nodes.length === 0 && (
                <EmptyState
                    title="No nodes to diagnose"
                    description="Create a node with Setup, download config, and start the CLI. Then return here."
                    href="/dashboard/provider/setup"
                    action="Setup wizard"
                />
            )}
            {!nodesLoading && nodes.length === 0 && (
                <div className="ui-actions">
                    <Link href="/dashboard/provider/cli" className="ui-button secondary">
                        CLI download
                    </Link>
                </div>
            )}

            <section className="ui-hero">
                <div>
                    <Status tone={checkTone(overall)}>
                        <span className="ui-inline-icon">
                            <StatusIcon status={overall} />
                            {overallLabel(overall)}
                        </span>
                    </Status>
                    <h2>{overallLabel(overall)}</h2>
                    <p>
                        {passing} passed · {warning} warnings · {failing} failed
                    </p>
                </div>
            </section>

            <section>
                {checks.map((check) => (
                    <div key={check.id} className="ui-row">
                        <div className="ui-row-identity">
                            <span className="ui-region">
                                <StatusIcon status={check.status} />
                            </span>
                            <div>
                                <h3>{check.label}</h3>
                                <p>{check.description}</p>
                                {check.detail && <p>{check.detail}</p>}
                            </div>
                        </div>
                        <Status tone={checkTone(check.status)}>
                            {check.status === 'loading' ? 'Checking' : check.status}
                        </Status>
                    </div>
                ))}
            </section>

            {nodes.length > 0 && (
                <section className="ui-surface">
                    <div className="ui-section-heading">
                        <h2>Node details</h2>
                    </div>
                    <div className="ui-table-wrap" role="region" aria-label="Node details" tabIndex={0}>
                        <table className="ui-table">
                            <thead>
                                <tr>
                                    <th>Node</th>
                                    <th>Location</th>
                                    <th>Uptime</th>
                                    <th>Latency</th>
                                    <th>Score</th>
                                    <th>Connections</th>
                                    <th>Checks</th>
                                    <th>Manage</th>
                                </tr>
                            </thead>
                            <tbody>
                                {nodes.map((node) => {
                                    const hist = uptimeByNode.get(node.id);
                                    return (
                                        <tr key={node.id}>
                                            <td>
                                                {node.name}
                                                <p>
                                                    <Status tone={node.status === 'online' ? 'good' : node.status === 'pending' ? 'warning' : 'error'}>
                                                        {node.status}
                                                    </Status>
                                                </p>
                                            </td>
                                            <td>
                                                {node.country ? (
                                                    <span className="ui-inline-icon">
                                                        <MapPin size={13} aria-hidden="true" />
                                                        {node.city ? `${node.city}, ` : ''}{node.country}
                                                    </span>
                                                ) : 'Not measured'}
                                            </td>
                                            <td>
                                                <span className="ui-inline-icon">
                                                    <Clock size={13} aria-hidden="true" />
                                                    {(hist?.uptime_percent ?? node.uptime_percent)?.toFixed(1) ?? 'Not measured'}%
                                                </span>
                                            </td>
                                            <td>
                                                <span className="ui-inline-icon">
                                                    <Wifi size={13} aria-hidden="true" />
                                                    {node.latency_ms != null ? `${node.latency_ms}ms` : 'Not measured'}
                                                </span>
                                            </td>
                                            <td>
                                                <span className="ui-inline-icon">
                                                    <BarChart3 size={13} aria-hidden="true" />
                                                    {node.quality_score?.toFixed(0) ?? 'Not measured'}
                                                </span>
                                            </td>
                                            <td>
                                                <span className="ui-inline-icon">
                                                    <Cpu size={13} aria-hidden="true" />
                                                    {node.active_connections ?? 0} conn
                                                </span>
                                            </td>
                                            <td>{hist ? `${hist.checks_24h} checks` : 'None yet'}</td>
                                            <td>
                                                <Link href="/dashboard/provider/nodes" className="ui-link">
                                                    Manage
                                                </Link>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </section>
            )}

            {failing > 0 && (
                <section className="ui-surface">
                    <div className="ui-section-heading">
                        <h2>Remediation tips</h2>
                    </div>
                    <div className="ui-note">
                        {nodes.length === 0 && (
                            <p>• Use <Link href="/dashboard/provider/setup" className="ui-link">Setup</Link> then <code>provider-node start</code> (not a second register).</p>
                        )}
                        {offlineNodes.length > 0 && (
                            <p>• {offlineNodes.length} node(s) offline/pending. Open My nodes → Connect and start the CLI.</p>
                        )}
                        {withWallet < nodes.length && nodes.length > 0 && (
                            <p>• Link a Solana wallet in <Link href="/dashboard/settings" className="ui-link">Settings</Link> so payout wallets auto-bind for claims.</p>
                        )}
                        {proofOk < nodes.length && nodes.length > 0 && (
                            <p>• Configure <code>provider_signing_key</code> (or linked wallet hotkey) for verified heartbeats.</p>
                        )}
                        {avgLatency !== null && avgLatency > 200 && (
                            <p>• High latency detected. Check your network connection.</p>
                        )}
                        {avgScore !== null && avgScore < 60 && (
                            <p>• Low quality score. Ensure stable uptime and sufficient bandwidth.</p>
                        )}
                    </div>
                </section>
            )}
        </div>
    );
}
