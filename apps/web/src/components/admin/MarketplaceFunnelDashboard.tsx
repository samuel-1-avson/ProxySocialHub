"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Loader2 } from "lucide-react";
import {
    getAdminMarketplaceFunnel,
    getSellerMarketplaceFunnel,
    type MarketplaceFunnelSummary,
    moderationKeys,
} from "@/lib/api/moderation";
import { getErrorMessage } from "@/lib/utils";

const COLLECTIONS = [
    { value: "", label: "All collections" },
    { value: "featured", label: "Featured" },
    { value: "verified", label: "Verified" },
    { value: "editors-pick", label: "Editor's pick" },
] as const;

const STEP_LABELS: Record<string, string> = {
    listing_view: "View",
    listing_save: "Save",
    buy_modal_open: "Buy modal",
    order_created: "Order",
    escrow_initiated: "Escrow start",
    escrow_confirmed: "Escrow confirmed",
    credentials_delivered: "Credentials",
};

function defaultFrom() {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 30);
    return d.toISOString().slice(0, 10);
}

function defaultTo() {
    return new Date().toISOString().slice(0, 10);
}

function pct(n: number | undefined) {
    if (n == null || Number.isNaN(n)) return "—";
    return `${(n * 100).toFixed(1)}%`;
}

type Props = {
    mode: "admin" | "seller";
    enabled: boolean;
};

export function MarketplaceFunnelDashboard({ mode, enabled }: Props) {
    const [from, setFrom] = useState(defaultFrom);
    const [to, setTo] = useState(defaultTo);
    const [collection, setCollection] = useState("");
    const [country, setCountry] = useState("");

    const params = useMemo(
        () => ({
            from,
            to,
            collection: collection || undefined,
            country: country || undefined,
        }),
        [from, to, collection, country],
    );

    const { data, isLoading, error, refetch, isFetching } = useQuery({
        queryKey:
            mode === "admin"
                ? moderationKeys.funnel(params)
                : (["analytics", "marketplace-funnel", params] as const),
        queryFn: () =>
            mode === "admin"
                ? getAdminMarketplaceFunnel(params)
                : getSellerMarketplaceFunnel(params),
        enabled,
    });

    return (
        <div data-testid="marketplace-funnel-dashboard" className="space-y-6">
            <div>
                <div className="flex items-center gap-2 text-primary font-bold uppercase tracking-wider text-xs mb-2">
                    <BarChart3 size={14} />
                    Marketplace funnel
                </div>
                <p className="text-sm text-muted-foreground">
                    View → save → order → escrow conversion from{" "}
                    <code className="text-xs bg-white/5 px-1 rounded">marketplace_funnel_events</code>
                    {mode === "seller" ? " for your listings." : "."}
                </p>
            </div>

            <div className="flex flex-wrap gap-3 items-end">
                <label className="space-y-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    From
                    <input
                        type="date"
                        value={from}
                        onChange={(e) => setFrom(e.target.value)}
                        className="block mt-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm font-mono text-foreground"
                    />
                </label>
                <label className="space-y-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    To
                    <input
                        type="date"
                        value={to}
                        onChange={(e) => setTo(e.target.value)}
                        className="block mt-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm font-mono text-foreground"
                    />
                </label>
                <label className="space-y-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Collection
                    <select
                        value={collection}
                        onChange={(e) => setCollection(e.target.value)}
                        className="block mt-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-foreground min-w-[10rem]"
                    >
                        {COLLECTIONS.map((c) => (
                            <option key={c.value || "all"} value={c.value}>
                                {c.label}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="space-y-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Country
                    <select
                        value={country}
                        onChange={(e) => setCountry(e.target.value)}
                        className="block mt-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-foreground min-w-[8rem]"
                    >
                        <option value="">All countries</option>
                        {(data?.countries ?? []).map((c) => (
                            <option key={c} value={c}>
                                {c}
                            </option>
                        ))}
                    </select>
                </label>
                <button
                    type="button"
                    onClick={() => void refetch()}
                    className="px-4 py-2 rounded-lg border border-white/10 text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-foreground"
                >
                    Refresh
                </button>
            </div>

            {(isLoading || isFetching) && (
                <div className="flex flex-col items-center py-12 gap-3">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
                        Loading funnel…
                    </p>
                </div>
            )}

            {error && (
                <p className="text-sm text-red-400">{getErrorMessage(error)}</p>
            )}

            {data && !isLoading && <FunnelBars data={data} />}
        </div>
    );
}

function FunnelBars({ data }: { data: MarketplaceFunnelSummary }) {
    const max = Math.max(1, ...data.steps.map((s) => s.count));

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Stat label="View → order" value={pct(data.conversion.view_to_order)} />
                <Stat
                    label="Order → escrow confirmed"
                    value={pct(data.conversion.order_to_escrow_confirmed)}
                />
                <Stat
                    label="View → escrow confirmed"
                    value={pct(data.conversion.view_to_escrow_confirmed)}
                />
            </div>

            <ul className="space-y-3">
                {data.steps.map((step) => {
                    const width = Math.max(2, Math.round((step.count / max) * 100));
                    return (
                        <li key={step.event_name} className="space-y-1">
                            <div className="flex justify-between text-xs font-mono">
                                <span className="text-muted-foreground uppercase tracking-wider">
                                    {STEP_LABELS[step.event_name] ?? step.event_name}
                                </span>
                                <span className="font-bold">{step.count.toLocaleString()}</span>
                            </div>
                            <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                                <div
                                    className="h-full rounded-full bg-primary/70"
                                    style={{ width: `${width}%` }}
                                />
                            </div>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div className="p-4 rounded-xl border border-white/10 bg-white/[0.02]">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
                {label}
            </p>
            <p className="text-2xl font-black font-mono">{value}</p>
        </div>
    );
}
