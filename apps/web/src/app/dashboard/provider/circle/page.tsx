"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    Users,
    Plus,
    Globe,
    Lock,
    Compass,
} from "lucide-react";
import {
    getCircles,
    getCirclePoolStatus,
    getCircleRevenue,
    claimCircleRevenue,
    contributeBandwidth,
    circlePoolingKeys,
    getUtilizationLabel,
    type CirclePoolStatus,
} from "@/lib/api/circlePooling";
import {
    getCircles as getBrowsableCircles,
    createCircle,
    joinCircle,
    type Circle as BrowsableCircle,
} from "@/lib/api/circles";
import { useNotificationStore } from "@/stores";
import { Modal } from "@/components/patterns/Modal";
import {
    PageHeading,
    Loading,
    DataError,
    EmptyState,
    Stat,
    Status,
    amount,
} from "@/components/workspace/Patterns";

interface ContributeModalProps {
    onClose: () => void;
    onSubmit: (data: { bandwidth_gb: number }) => void;
    isSubmitting: boolean;
    poolStatus?: CirclePoolStatus;
}

export default function CirclePoolingPage() {
    const { addNotification } = useNotificationStore();
    const queryClient = useQueryClient();
    const [selectedCircleId, setSelectedCircleId] = useState<string | null>(null);
    const [contributeModalOpen, setContributeModalOpen] = useState(false);
    const [browseModalOpen, setBrowseModalOpen] = useState(false);

    // Fetch user's circles
    const { data: circles = [], isLoading: circlesLoading, isError: circlesError, error: circlesQueryError, refetch: refetchCircles } = useQuery({
        queryKey: circlePoolingKeys.circles(),
        queryFn: getCircles,
    });

    // Auto-select first circle if none selected
    React.useEffect(() => {
        if (circles.length > 0 && !selectedCircleId) {
            setSelectedCircleId(circles[0].id);
        }
    }, [circles, selectedCircleId]);

    const selectedCircle = circles.find(c => c.id === selectedCircleId);

    // Fetch pool status for selected circle
    const { data: poolStatus, isLoading: poolLoading, isError: poolError, error: poolQueryError, refetch: refetchPool } = useQuery({
        queryKey: circlePoolingKeys.status(selectedCircleId || ""),
        queryFn: () => getCirclePoolStatus(selectedCircleId!),
        enabled: !!selectedCircleId,
        refetchInterval: 15000,
    });

    // Fetch revenue for selected circle
    const { data: revenueData, isLoading: revenueLoading, isError: revenueError, error: revenueQueryError, refetch: refetchRevenue } = useQuery({
        queryKey: circlePoolingKeys.revenues(selectedCircleId || ""),
        queryFn: () => getCircleRevenue(selectedCircleId!),
        enabled: !!selectedCircleId,
    });

    const contributeMutation = useMutation({
        retry: false,
        mutationFn: ({ circleId, bandwidth }: { circleId: string; bandwidth: number }) =>
            contributeBandwidth(circleId, { bandwidth_gb: bandwidth }),
        onSuccess: () => {
            addNotification({
                type: "success",
                title: "TELEMETRY SYNCED",
                message: "Bandwidth coupled to enterprise pool successfully.",
            });
            setContributeModalOpen(false);
            queryClient.invalidateQueries({ queryKey: circlePoolingKeys.all });
        },
        onError: (error: Error) => {
            addNotification({
                type: "error",
                title: "SYNC FAILED",
                message: error.message,
            });
        },
    });

    const claimRevenueMutation = useMutation({
        retry: false,
        mutationFn: claimCircleRevenue,
        onSuccess: (data) => {
            addNotification({
                type: "success",
                title: "REVENUE ACCESSED",
                message: `${data.amount.toFixed(6)} SOL credited to your local balance.`,
            });
            queryClient.invalidateQueries({ queryKey: circlePoolingKeys.all });
        },
        onError: (error: Error) => {
            addNotification({
                type: "error",
                title: "ACCESS DENIED",
                message: error.message,
            });
        },
    });

    const handleCircleReady = (circleId: string) => {
        setSelectedCircleId(circleId);
        setBrowseModalOpen(false);
        queryClient.invalidateQueries({ queryKey: circlePoolingKeys.circles() });
    };

    const loading = circlesLoading || poolLoading || revenueLoading;

    if (loading && circles.length === 0) {
        return (
            <div className="ui-page">
                <PageHeading
                    eyebrow="Revenue distribution"
                    title="Circle pool"
                    description="Join a pooling circle to share bandwidth and settle shared revenue."
                />
                <Loading label="Loading your circle pools…" />
            </div>
        );
    }

    if (circles.length === 0) {
        return (
            <div className="ui-page">
                <PageHeading
                    eyebrow="Revenue distribution"
                    title="Circle pool"
                    description="Join a pooling circle to share bandwidth and settle shared revenue."
                />
                {circlesError && (
                    <DataError error={circlesQueryError} retry={() => void refetchCircles()} />
                )}
                <EmptyState
                    title="No active circles detected"
                    description="Join a cryptographic pooling circle to start distributing enterprise bandwidth."
                />
                <div className="ui-actions">
                    <button
                        type="button"
                        onClick={() => setBrowseModalOpen(true)}
                        className="ui-button"
                    >
                        <Compass size={14} aria-hidden="true" /> Browse circles
                    </button>
                </div>
                {browseModalOpen && (
                    <CircleBrowseModal
                        onClose={() => setBrowseModalOpen(false)}
                        existingCircleIds={circles.map((c) => c.id)}
                        onCircleReady={handleCircleReady}
                    />
                )}
            </div>
        );
    }

    return (
        <div className="ui-page">
            <PageHeading
                eyebrow="Revenue distribution"
                title="Circle pool"
                description="Join a pooling circle to share bandwidth and settle shared revenue."
                actions={
                    <>
                        {circles.length > 1 && (
                            <label className="ui-field compact">
                                Circle
                                <select
                                    value={selectedCircleId || ""}
                                    onChange={(e) => setSelectedCircleId(e.target.value)}
                                    className="ui-select"
                                >
                                    {circles.map((circle) => (
                                        <option key={circle.id} value={circle.id}>
                                            {circle.name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        )}
                        <button
                            type="button"
                            onClick={() => setBrowseModalOpen(true)}
                            className="ui-button secondary"
                        >
                            <Compass size={14} aria-hidden="true" /> Browse circles
                        </button>
                        <button
                            type="button"
                            onClick={() => setContributeModalOpen(true)}
                            className="ui-button"
                        >
                            <Plus size={14} aria-hidden="true" /> Contribute bandwidth
                        </button>
                    </>
                }
            />

            {poolError && (
                <DataError error={poolQueryError} retry={() => void refetchPool()} />
            )}
            {revenueError && (
                <DataError error={revenueQueryError} retry={() => void refetchRevenue()} />
            )}

            {selectedCircle && (
                <section className="ui-hero">
                    <div>
                        <Status tone="neutral">{selectedCircle.type} tier</Status>
                        <h2>{selectedCircle.name}</h2>
                        <p>
                            {selectedCircle.member_count} members · {amount(selectedCircle.bandwidth_pool_gb, 0)} GB committed
                        </p>
                    </div>
                </section>
            )}

            <div className="ui-columns">
                {poolStatus && (
                    <section className="ui-surface">
                        <div className="ui-section-heading">
                            <h2>Pool telemetry</h2>
                            <Status
                                tone={
                                    poolStatus.utilization_percent > 80
                                        ? "error"
                                        : poolStatus.utilization_percent > 50
                                            ? "warning"
                                            : "good"
                                }
                            >
                                {getUtilizationLabel(poolStatus.utilization_percent)} · {poolStatus.utilization_percent.toFixed(1)}%
                            </Status>
                        </div>
                        <p className="ui-note">Real-time status monitor</p>
                        <div className="ui-section-space">
                            <div className="flex justify-between text-[13px] text-muted-foreground mb-2">
                                <span>Utilization</span>
                                <span>
                                    {poolStatus.used_capacity_gb.toFixed(1)} / {poolStatus.total_capacity_gb.toFixed(0)} GB
                                </span>
                            </div>
                            <div className="h-3 bg-secondary rounded-full overflow-hidden">
                                <div
                                    className={`h-full ${
                                        poolStatus.utilization_percent > 80 ? "bg-rose-500" :
                                        poolStatus.utilization_percent > 50 ? "bg-amber-500" :
                                        "bg-emerald-500"
                                    }`}
                                    style={{ width: `${poolStatus.utilization_percent}%` }}
                                />
                            </div>
                        </div>
                        <section className="ui-stats ui-section-space">
                            <Stat
                                label="Remaining"
                                value={`${amount(poolStatus.available_capacity_gb, 1)} GB`}
                                detail="Available capacity"
                            />
                            <Stat
                                label="Nodes"
                                value={poolStatus.member_count}
                                detail="Participating members"
                            />
                            <Stat
                                label="Live streams"
                                value={poolStatus.active_session_count}
                                detail="Active sessions"
                            />
                        </section>
                        {poolStatus.is_enterprise_ready && (
                            <div className="ui-attention ui-section-space">
                                <h3>Enterprise integrity verified</h3>
                                <p>Ready for high-concurrency contracts.</p>
                            </div>
                        )}
                    </section>
                )}

                {revenueData && (
                    <section className="ui-surface">
                        <div className="ui-section-heading">
                            <h2>Economic center</h2>
                            {revenueData.available > 0 && (
                                <button
                                    type="button"
                                    onClick={() => selectedCircleId && claimRevenueMutation.mutate(selectedCircleId)}
                                    disabled={claimRevenueMutation.isPending}
                                    className="ui-button"
                                >
                                    {claimRevenueMutation.isPending
                                        ? "Claiming…"
                                        : `Claim ${amount(revenueData.available, 6)} SOL`}
                                </button>
                            )}
                        </div>
                        <section className="ui-stats">
                            <Stat
                                label="Lifetime"
                                value={`${amount(revenueData.total_earned, 6)} SOL`}
                                detail="Total earned in this circle"
                            />
                            <Stat
                                label="Extracted"
                                value={`${amount(revenueData.total_claimed, 6)} SOL`}
                                detail="Already claimed"
                            />
                            <Stat
                                label="Floating"
                                value={`${amount(revenueData.available, 6)} SOL`}
                                detail="Available to claim"
                            />
                        </section>
                        <div className="ui-section-space">
                            {revenueData.revenues.length === 0 ? (
                                <EmptyState
                                    title="Awaiting settlement cycles"
                                    description="Revenue periods will appear here after the circle records sessions."
                                />
                            ) : (
                                <div className="ui-table-wrap" role="region" aria-label="Circle revenue" tabIndex={0}>
                                    <table className="ui-table">
                                        <thead>
                                            <tr>
                                                <th>Period</th>
                                                <th>Sessions</th>
                                                <th>Share</th>
                                                <th>Revenue</th>
                                                <th>Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {revenueData.revenues.map((revenue) => (
                                                <tr key={revenue.revenue_id}>
                                                    <td>{new Date(revenue.period_start).toLocaleDateString(undefined, { month: "short", year: "numeric" })}</td>
                                                    <td>{revenue.sessions_count}</td>
                                                    <td>{revenue.provider_share_percent.toFixed(1)}%</td>
                                                    <td>{amount(revenue.provider_revenue, 6)} SOL</td>
                                                    <td>
                                                        <Status tone="neutral">{revenue.status}</Status>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </section>
                )}
            </div>

            {poolStatus?.members && poolStatus.members.length > 0 && (
                <section className="ui-surface">
                    <div className="ui-section-heading">
                        <h2>Member registry</h2>
                    </div>
                    <p className="ui-note">Authorized sector participants</p>
                    <div>
                        {poolStatus.members.slice(0, 6).map((member) => (
                            <div key={member.provider_id} className="ui-row">
                                <div className="ui-row-identity">
                                    <span className="ui-region overflow-hidden">
                                        {member.avatar_url ? (
                                            <img src={member.avatar_url} alt={member.provider_name} className="w-full h-full object-cover" />
                                        ) : (
                                            <Users size={16} aria-hidden="true" />
                                        )}
                                    </span>
                                    <div>
                                        <h3>{member.provider_name || "Anonymous operator"}</h3>
                                        <p>
                                            {member.share_percent.toFixed(1)}% share · {amount(member.revenue_earned, 6)} SOL total
                                        </p>
                                    </div>
                                </div>
                                <Status tone={member.is_online ? "good" : "neutral"}>
                                    {member.is_online ? "Online" : "Offline"}
                                </Status>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {contributeModalOpen && selectedCircleId && (
                <ContributeModal
                    onClose={() => setContributeModalOpen(false)}
                    onSubmit={(data) =>
                        contributeMutation.mutate({ circleId: selectedCircleId, bandwidth: data.bandwidth_gb })
                    }
                    isSubmitting={contributeMutation.isPending}
                    poolStatus={poolStatus}
                />
            )}
            {browseModalOpen && (
                <CircleBrowseModal
                    onClose={() => setBrowseModalOpen(false)}
                    existingCircleIds={circles.map((c) => c.id)}
                    onCircleReady={handleCircleReady}
                />
            )}
        </div>
    );
}

function ContributeModal({ onClose, onSubmit, isSubmitting, poolStatus }: ContributeModalProps) {
    const [bandwidthGb, setBandwidthGb] = useState(100);
    const projectedShare =
        poolStatus && poolStatus.total_capacity_gb > 0
            ? ((bandwidthGb / (poolStatus.total_capacity_gb + bandwidthGb)) * 100).toFixed(1)
            : "100";

    return (
        <Modal
            open
            onOpenChange={(open) => {
                if (!open) onClose();
            }}
            title="Pool contribution"
            description="Injecting sector bandwidth"
            size="md"
            footer={
                <>
                    <button type="button" className="ui-button secondary" onClick={onClose}>
                        Abort
                    </button>
                    <button
                        type="button"
                        className="ui-button"
                        onClick={() => onSubmit({ bandwidth_gb: bandwidthGb })}
                        disabled={isSubmitting}
                    >
                        {isSubmitting ? "Establishing sync…" : "Establish sync"}
                    </button>
                </>
            }
        >
            <div className="ui-page">
                <label className="ui-field">
                    Required capacity: {bandwidthGb} GB
                    <input
                        type="range"
                        min="10"
                        max="1000"
                        step="10"
                        value={bandwidthGb}
                        onChange={(e) => setBandwidthGb(Number(e.target.value))}
                    />
                </label>
                <div className="ui-attention">
                    <h3>Projected reward share</h3>
                    <p>
                        {projectedShare}% based on target pool saturation of {((poolStatus?.total_capacity_gb || 0) + bandwidthGb).toFixed(0)} GB.
                    </p>
                </div>
            </div>
        </Modal>
    );
}

interface CircleBrowseModalProps {
    onClose: () => void;
    existingCircleIds: string[];
    onCircleReady: (circleId: string) => void;
}

function CircleBrowseModal({ onClose, existingCircleIds, onCircleReady }: CircleBrowseModalProps) {
    const { addNotification } = useNotificationStore();
    const [tab, setTab] = useState<"browse" | "create">("browse");
    const [form, setForm] = useState({ name: "", description: "", visibility: "public" as "public" | "private" });

    const { data: browsableCircles = [], isLoading: browseLoading, error: browseError } = useQuery({
        queryKey: ["circles-browse-public"],
        queryFn: getBrowsableCircles,
    });

    const joinMutation = useMutation({
        retry: false,
        mutationFn: (circleId: string) => joinCircle(circleId),
        onSuccess: (_data, circleId) => {
            addNotification({
                type: "success",
                title: "CIRCLE JOINED",
                message: "You now have access to this pool.",
            });
            onCircleReady(circleId);
        },
        onError: (error: Error) => {
            addNotification({ type: "error", title: "JOIN FAILED", message: error.message });
        },
    });

    const createMutation = useMutation({
        retry: false,
        mutationFn: () =>
            createCircle({
                name: form.name.trim(),
                description: form.description.trim(),
                visibility: form.visibility,
            }),
        onSuccess: (circle) => {
            addNotification({
                type: "success",
                title: "CIRCLE CREATED",
                message: `${circle.name} is ready to receive contributions.`,
            });
            onCircleReady(circle.id);
        },
        onError: (error: Error) => {
            addNotification({ type: "error", title: "CREATE FAILED", message: error.message });
        },
    });

    const existingSet = new Set(existingCircleIds);

    return (
        <Modal
            open
            onOpenChange={(open) => {
                if (!open) onClose();
            }}
            title="Circle directory"
            description="Browse or launch a pooling circle"
            size="lg"
        >
            <nav className="ui-tabs" aria-label="Circle directory">
                <button
                    type="button"
                    onClick={() => setTab("browse")}
                    className={tab === "browse" ? "active" : ""}
                >
                    Browse
                </button>
                <button
                    type="button"
                    onClick={() => setTab("create")}
                    className={tab === "create" ? "active" : ""}
                >
                    Create circle
                </button>
            </nav>

            {tab === "browse" ? (
                <div className="ui-section-space">
                    {browseLoading ? (
                        <Loading label="Scanning public circles…" />
                    ) : browseError ? (
                        <DataError error={browseError} />
                    ) : browsableCircles.length === 0 ? (
                        <EmptyState
                            title="No public circles available yet"
                            description="Create the first pooling circle to start sharing bandwidth."
                        />
                    ) : (
                        <div>
                            {browsableCircles.map((circle: BrowsableCircle) => {
                                const alreadyMember = existingSet.has(circle.id);
                                return (
                                    <div
                                        key={circle.id}
                                        className="ui-row"
                                    >
                                        <div>
                                            <h3>{circle.name}</h3>
                                            {circle.description && (
                                                <p>{circle.description}</p>
                                            )}
                                            <p className="ui-note">
                                                {circle.visibility === "private" ? "Private" : "Public"}
                                                {" · "}
                                                {circle.member_count} members
                                                {" · "}
                                                {circle.bandwidth_pool_gb?.toFixed?.(0) ?? 0} GB
                                            </p>
                                        </div>
                                        {alreadyMember ? (
                                            <Status tone="good">Joined</Status>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={() => joinMutation.mutate(circle.id)}
                                                disabled={joinMutation.isPending}
                                                className="ui-button small"
                                            >
                                                {joinMutation.isPending && joinMutation.variables === circle.id
                                                    ? "Joining…"
                                                    : "Join"}
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    {browsableCircles.length === 0 && !browseLoading && !browseError && (
                        <div className="ui-actions">
                            <button
                                type="button"
                                onClick={() => setTab("create")}
                                className="ui-button"
                            >
                                Create the first one
                            </button>
                        </div>
                    )}
                </div>
            ) : (
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (!form.name.trim()) return;
                        createMutation.mutate();
                    }}
                    className="ui-page ui-section-space"
                >
                    <label className="ui-field">
                        Circle name
                        <input
                            type="text"
                            value={form.name}
                            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                            placeholder="e.g. West Coast Pool"
                            required
                            className="ui-input"
                        />
                    </label>
                    <label className="ui-field">
                        Description
                        <textarea
                            value={form.description}
                            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                            placeholder="What is this circle for?"
                            rows={3}
                            className="ui-input"
                        />
                    </label>
                    <div>
                        <p className="ui-note mb-2">Visibility</p>
                        <div className="ui-tabs" role="tablist" aria-label="Visibility">
                            {(["public", "private"] as const).map((v) => (
                                <button
                                    type="button"
                                    key={v}
                                    onClick={() => setForm((f) => ({ ...f, visibility: v }))}
                                    className={form.visibility === v ? "active" : ""}
                                >
                                    {v === "private" ? <Lock size={14} aria-hidden="true" /> : <Globe size={14} aria-hidden="true" />}
                                    {" "}{v}
                                </button>
                            ))}
                        </div>
                    </div>
                    <button
                        type="submit"
                        disabled={createMutation.isPending || !form.name.trim()}
                        className="ui-button"
                    >
                        {createMutation.isPending ? "Launching…" : "Launch circle"}
                    </button>
                </form>
            )}
        </Modal>
    );
}
