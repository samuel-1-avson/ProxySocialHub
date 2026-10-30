'use client';

import Link from 'next/link';
import { getProviderNodes, ProviderNode } from '@/lib/api/marketplace';
import { getProviderEarningsSummary, getNodeUptime } from '@/lib/api/provider';
import { ProviderScoreCard } from '@/components/ProviderScoreCard';
import { MarketplaceFunnelDashboard } from '@/components/admin/MarketplaceFunnelDashboard';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import {
    PageHeading,
    Loading,
    DataError,
    EmptyState,
    Stat,
    Status,
    amount,
} from '@/components/workspace/Patterns';

async function fetchProviderNodes(): Promise<ProviderNode[]> {
    const data = await getProviderNodes();
    return data.nodes || [];
}

type NodeUptimeData = Awaited<ReturnType<typeof getNodeUptime>>;

function uptimeBarColor(percent: number): string {
    if (percent >= 99) return 'bg-success';
    if (percent >= 95) return 'bg-warning';
    return 'bg-destructive';
}

export default function ProviderAnalyticsPage() {
    const { isAuthenticated } = useAuth();
    const { data: nodes = [], isLoading: loading, isError: nodesError, error: nodesQueryError, refetch: refetchNodes } = useQuery({
        queryKey: ['provider-nodes-analytics'],
        queryFn: fetchProviderNodes,
        retry: 2,
    });

    const { data: earnings } = useQuery({
        queryKey: ['provider-earnings-summary'],
        queryFn: getProviderEarningsSummary,
        staleTime: 30_000,
    });

    const nodeIds = nodes.map((n) => n.id).join(',');
    const { data: uptimeByNode = {} } = useQuery({
        queryKey: ['provider-nodes-uptime', nodeIds],
        queryFn: async () => {
            const results = await Promise.allSettled(nodes.map((n) => getNodeUptime(n.id)));
            const map: Record<string, NodeUptimeData> = {};
            results.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    map[nodes[index].id] = result.value;
                }
            });
            return map;
        },
        enabled: nodes.length > 0,
        staleTime: 30_000,
    });

    if (loading) {
        return (
            <div className="ui-page">
                <PageHeading
                    eyebrow="Performance analytics"
                    title="Provider scorecard"
                    description="Real-time trust metrics, node performance, and earnings."
                />
                <Loading label="Loading network performance…" />
            </div>
        );
    }

    const hasActiveNodes = nodes.length > 0;
    const totalEarned = earnings?.total_earned_sol ?? 0;

    const uptimeEntries = nodes
        .map((n) => uptimeByNode[n.id]?.uptime_percent ?? n.uptime_percent)
        .filter((v): v is number => typeof v === 'number');
    const avgUptime = uptimeEntries.length > 0
        ? uptimeEntries.reduce((acc, v) => acc + v, 0) / uptimeEntries.length
        : null;

    const latencyEntries = nodes
        .map((n) => uptimeByNode[n.id]?.avg_latency_ms ?? n.latency_ms)
        .filter((v): v is number => typeof v === 'number' && v > 0);
    const avgLatency = latencyEntries.length > 0
        ? latencyEntries.reduce((acc, v) => acc + v, 0) / latencyEntries.length
        : null;

    const totalSessions = earnings?.total_sessions ?? null;

    return (
        <div className="ui-page">
            <PageHeading
                eyebrow="Performance analytics"
                title="Provider scorecard"
                description="Real-time trust metrics, node performance, and earnings."
            />

            {nodesError && (
                <DataError error={nodesQueryError} retry={() => void refetchNodes()} />
            )}

            <section className="ui-surface">
                <MarketplaceFunnelDashboard mode="seller" enabled={isAuthenticated} />
            </section>

            {!hasActiveNodes ? (
                <EmptyState
                    title="No nodes yet"
                    description="Add a node with the setup wizard, then start the CLI. Stats appear after your first heartbeat."
                    href="/dashboard/provider/setup"
                    action="Setup wizard"
                />
            ) : (
                <>
                    <section className="ui-stats">
                        <Stat
                            label="Total earnings"
                            value={`${amount(totalEarned, 4)} SOL`}
                            detail={`Pending ${amount(earnings?.pending_sol ?? 0, 4)} SOL`}
                        />
                        <Stat
                            label="Active nodes"
                            value={`${nodes.filter(n => n.status === 'online').length}/${nodes.length}`}
                            detail="Online now"
                        />
                        <Stat
                            label="Trust score"
                            value={(nodes.length > 0 ? (nodes.reduce((acc, n) => acc + (Number(n.quality_score) || 0), 0) / nodes.length) : 0).toFixed(1)}
                            detail="Average across nodes"
                        />
                    </section>
                    <section className="ui-stats">
                        <Stat
                            label="Connections"
                            value={nodes.reduce((acc, n) => acc + (n.active_connections || 0), 0)}
                            detail="Active right now"
                        />
                        <Stat
                            label="Avg uptime (30d)"
                            value={avgUptime !== null ? `${avgUptime.toFixed(1)}%` : 'Not measured'}
                            detail="Across all reporting nodes"
                        />
                        <Stat
                            label="Avg latency"
                            value={avgLatency !== null ? `${avgLatency.toFixed(0)} ms` : 'Not measured'}
                            detail="Across all reporting nodes"
                        />
                    </section>
                    <p className="ui-note">
                        Pending {amount(earnings?.pending_sol ?? 0, 4)} SOL ·{' '}
                        <Link href="/dashboard/provider/earnings" className="ui-link">Income</Link>
                        {' · '}
                        Lifetime sessions: {totalSessions !== null ? totalSessions.toLocaleString() : 'None yet'}
                    </p>

                    <section className="ui-surface">
                        <div className="ui-section-heading">
                            <h2>Node availability (30d)</h2>
                        </div>
                        {nodes.map((node) => {
                            const uptime = uptimeByNode[node.id];
                            const uptimePercent = uptime?.uptime_percent ?? node.uptime_percent ?? null;
                            const latency = uptime?.avg_latency_ms ?? node.latency_ms ?? null;
                            return (
                                <div key={node.id} className="ui-row">
                                    <div className="ui-row-identity">
                                        <span className="ui-region">
                                            <Status tone={node.status === 'online' ? 'good' : 'error'}>
                                                {node.status}
                                            </Status>
                                        </span>
                                        <div>
                                            <h3>{node.name || node.ip_address || node.id.slice(0, 8)}</h3>
                                            <p>
                                                {uptimePercent !== null ? `${uptimePercent.toFixed(1)}% uptime` : 'No uptime data yet'}
                                                {' · '}
                                                {latency !== null ? `${latency.toFixed(0)}ms` : 'Not measured'}
                                                {uptime?.current_status ? ` · ${uptime.current_status}` : ''}
                                            </p>
                                        </div>
                                    </div>
                                    {uptimePercent !== null ? (
                                        <div className="min-w-[120px] flex-1">
                                            <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                                                <div
                                                    className={`h-full rounded-full ${uptimeBarColor(uptimePercent)}`}
                                                    style={{ width: `${Math.min(100, Math.max(0, uptimePercent))}%` }}
                                                />
                                            </div>
                                        </div>
                                    ) : (
                                        <p className="ui-note">No uptime data yet</p>
                                    )}
                                </div>
                            );
                        })}
                    </section>

                    <section>
                        <div className="ui-section-heading">
                            <h2>Your nodes</h2>
                            <div className="ui-actions">
                                <Link href="/dashboard/provider/health" className="ui-link">Diagnostics</Link>
                                <Link href="/dashboard/provider/nodes" className="ui-link">Manage</Link>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                            {nodes.map(node => (
                                <ProviderScoreCard key={node.id} node={node} />
                            ))}
                        </div>
                    </section>

                    <section className="ui-attention">
                        <h3>Scale your earnings</h3>
                        <p>Add more nodes to increase your earning potential.</p>
                        <Link
                            href="/dashboard/provider/setup"
                            className="ui-button"
                        >
                            Add node
                        </Link>
                    </section>
                </>
            )}

            {!hasActiveNodes && (
                <div className="ui-actions">
                    <Link href="/dashboard/provider/cli" className="ui-button secondary">
                        CLI download
                    </Link>
                </div>
            )}
        </div>
    );
}
