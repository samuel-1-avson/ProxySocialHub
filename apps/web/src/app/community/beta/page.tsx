"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import {
    completeBetaTask,
    fetchBetaProgram,
    syncBetaProgram,
    uncompleteBetaTask,
    type BetaProgramResponse,
    type BetaProgramTask,
} from "@/lib/beta-program";
import { GlassCard } from "@/components/ui/glass-card";
import { CheckCircle2, Circle, ExternalLink, Loader2, RefreshCw, Trophy } from "lucide-react";

export default function BetaProgramPage() {
    const { isAuthenticated } = useAuth();
    const [data, setData] = useState<BetaProgramResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [busySlug, setBusySlug] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetchBetaProgram();
            setData(res);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load, isAuthenticated]);

    const tasksByWeek = useMemo(() => {
        if (!data) return new Map<number, BetaProgramTask[]>();
        const map = new Map<number, BetaProgramTask[]>();
        for (const task of data.tasks) {
            const week = task.week;
            if (!map.has(week)) map.set(week, []);
            map.get(week)!.push(task);
        }
        return map;
    }, [data]);

    const weekLabels: Record<number, string> = {
        0: "Onboarding",
        1: "Week 1: Basics",
        2: "Week 2: Advanced",
        3: "Week 3: Edge cases",
        4: "Week 4: Stress & feedback",
    };

    const toggleTask = async (task: BetaProgramTask) => {
        if (!isAuthenticated) return;
        setBusySlug(task.slug);
        try {
            if (task.completed) {
                await uncompleteBetaTask(task.slug);
            } else {
                await completeBetaTask(task.slug);
            }
            await load();
        } finally {
            setBusySlug(null);
        }
    };

    const handleSync = async () => {
        if (!isAuthenticated) return;
        setSyncing(true);
        try {
            await syncBetaProgram();
            await load();
        } finally {
            setSyncing(false);
        }
    };

    if (loading && !data) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
                <Loader2 className="animate-spin text-primary" size={32} />
                <p className="text-xs font-semibold text-muted-foreground/40">
                    Loading beta program…
                </p>
            </div>
        );
    }

    if (!data) {
        return (
            <div className="max-w-3xl mx-auto py-20 text-center text-muted-foreground">
                Could not load the beta program. Try again later.
            </div>
        );
    }

    const progress =
        data.stats.total_tasks > 0
            ? Math.round((data.stats.completed_tasks / data.stats.total_tasks) * 100)
            : 0;

    return (
        <div className="max-w-4xl mx-auto space-y-10 pb-20">
            <header className="space-y-4">
                <p className="text-xs font-semibold text-primary/70">
                    DevNet · {data.program.network}
                </p>
                <h1 className="text-3xl font-semibold tracking-tight">{data.program.name}</h1>
                <p className="text-sm text-muted-foreground/70 max-w-2xl leading-relaxed">
                    Track beta tasks from the community testing program, sync auto-detected progress, and jump to
                    the right flows. Payouts and leaderboard rewards are handled via Discord after verification.
                </p>
            </header>

            <GlassCard className="!p-6 border-primary/20 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <Trophy className="text-primary" size={22} />
                        <div>
                            <p className="text-xs font-semibold text-muted-foreground/50">
                                Progress
                            </p>
                            <p className="text-lg font-semibold">
                                {data.stats.completed_tasks} / {data.stats.total_tasks} tasks
                            </p>
                        </div>
                    </div>
                    <div className="text-right">
                        <p className="text-xs font-semibold text-muted-foreground/50">
                            Tracked rewards (guide)
                        </p>
                        <p className="text-lg font-semibold text-success">
                            {data.stats.earned_usdc.toFixed(6)} / {data.stats.potential_usdc.toFixed(6)} SOL
                        </p>
                    </div>
                </div>
                <div className="h-2 rounded-full bg-secondary overflow-hidden">
                    <div
                        className="h-full bg-primary transition-all"
                        style={{ width: `${progress}%` }}
                    />
                </div>
                <div className="flex flex-wrap gap-3">
                    <a
                        href={data.program.discord_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 text-xs font-semibold px-4 py-2 rounded-lg border border-border hover:border-primary/40"
                    >
                        Discord #beta-testers
                        <ExternalLink size={12} />
                    </a>
                    {isAuthenticated ? (
                        <button
                            type="button"
                            onClick={() => void handleSync()}
                            disabled={syncing}
                            className="inline-flex items-center gap-2 text-xs font-semibold px-4 py-2 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50"
                        >
                            {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                            Sync auto-detected
                        </button>
                    ) : (
                        <Link
                            href="/login"
                            className="text-xs font-semibold text-primary/80 hover:text-primary"
                        >
                            Sign in to track tasks
                        </Link>
                    )}
                </div>
            </GlassCard>

            {[...tasksByWeek.entries()]
                .sort(([a], [b]) => a - b)
                .map(([week, tasks]) => (
                    <section key={week} className="space-y-4">
                        <h2 className="text-xs font-semibold text-muted-foreground/50">
                            {weekLabels[week] ?? `Week ${week}`}
                        </h2>
                        <ul className="space-y-3">
                            {tasks.map((task) => (
                                <li key={task.slug}>
                                    <GlassCard className="!p-4 flex flex-col sm:flex-row sm:items-center gap-4 border-border">
                                        <button
                                            type="button"
                                            disabled={!isAuthenticated || busySlug === task.slug}
                                            onClick={() => void toggleTask(task)}
                                            className="flex items-start gap-3 text-left disabled:opacity-60 shrink-0"
                                            aria-pressed={task.completed}
                                        >
                                            {busySlug === task.slug ? (
                                                <Loader2 size={22} className="animate-spin text-primary mt-0.5" />
                                            ) : task.completed ? (
                                                <CheckCircle2 size={22} className="text-success mt-0.5" />
                                            ) : (
                                                <Circle size={22} className="text-muted-foreground/30 mt-0.5" />
                                            )}
                                            <div>
                                                <p className="text-sm font-semibold tracking-tight">
                                                    {task.title}
                                                </p>
                                                {task.reward_usdc > 0 ? (
                                                    <p className="text-xs font-semibold text-success/80 mt-1">
                                                        Up to {Number(task.reward_usdc).toFixed(6)} SOL (guide)
                                                    </p>
                                                ) : null}
                                            </div>
                                        </button>
                                        <p className="text-xs text-muted-foreground/60 flex-1">{task.description}</p>
                                        <div className="flex gap-2 shrink-0">
                                            {task.path ? (
                                                <Link
                                                    href={task.path}
                                                    className="text-xs font-semibold px-3 py-2 rounded-lg border border-border hover:border-primary/30"
                                                >
                                                    Open
                                                </Link>
                                            ) : null}
                                            {task.external_url ? (
                                                <a
                                                    href={task.external_url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-xs font-semibold px-3 py-2 rounded-lg border border-border hover:border-primary/30 inline-flex items-center gap-1"
                                                >
                                                    External
                                                    <ExternalLink size={10} />
                                                </a>
                                            ) : null}
                                        </div>
                                    </GlassCard>
                                </li>
                            ))}
                        </ul>
                    </section>
                ))}
        </div>
    );
}
