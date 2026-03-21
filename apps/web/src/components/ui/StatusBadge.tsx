"use client";

import React from "react";
import { CheckCircle2, AlertTriangle, XCircle, Clock, Loader2 } from "lucide-react";

export type StatusType = "online" | "offline" | "degraded" | "pending" | "processing";

interface StatusBadgeProps {
    status: StatusType;
    label?: string;
    pulse?: boolean;
}

const statusConfig = {
    online: {
        color: "text-emerald-500",
        bg: "bg-emerald-500/10",
        border: "border-emerald-500/20",
        icon: CheckCircle2,
        defaultLabel: "Online"
    },
    degraded: {
        color: "text-amber-500",
        bg: "bg-amber-500/10",
        border: "border-amber-500/20",
        icon: AlertTriangle,
        defaultLabel: "Degraded"
    },
    offline: {
        color: "text-red-500",
        bg: "bg-red-500/10",
        border: "border-red-500/20",
        icon: XCircle,
        defaultLabel: "Offline"
    },
    pending: {
        color: "text-muted-foreground",
        bg: "bg-white/10",
        border: "border-white/10",
        icon: Clock,
        defaultLabel: "Pending"
    },
    processing: {
        color: "text-blue-400",
        bg: "bg-blue-400/10",
        border: "border-blue-400/20",
        icon: Loader2,
        defaultLabel: "Processing"
    }
};

export function StatusBadge({ status, label, pulse = false }: StatusBadgeProps) {
    const config = statusConfig[status];
    const Icon = config.icon;
    const isProcessing = status === "processing";

    return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${config.bg} ${config.color} ${config.border}`}>
            <div className="relative flex h-3 w-3 items-center justify-center">
                {pulse && <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping bg-current`} />}
                <Icon size={12} className={isProcessing ? "animate-spin" : ""} strokeWidth={2.5} />
            </div>
            {label || config.defaultLabel}
        </span>
    );
}
