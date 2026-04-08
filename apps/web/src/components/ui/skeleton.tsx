/**
 * Skeleton Components
 * Loading placeholders with animated pulse effects
 */

import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';

interface SkeletonProps {
    className?: string;
    style?: CSSProperties;
}

/**
 * Base Skeleton component with pulse animation
 */
export function Skeleton({ className, style }: SkeletonProps) {
    return (
        <div
            className={cn(
                "animate-pulse rounded-sm bg-muted",
                className
            )}
            style={style}
        />
    );
}

/**
 * Text line skeleton
 */
export function SkeletonText({ className, lines = 1 }: SkeletonProps & { lines?: number }) {
    return (
        <div className={cn("space-y-2", className)}>
            {Array.from({ length: lines }).map((_, i) => (
                <Skeleton
                    key={i}
                    className={cn(
                        "h-4",
                        i === lines - 1 && lines > 1 ? "w-3/4" : "w-full"
                    )}
                />
            ))}
        </div>
    );
}

/**
 * Avatar skeleton
 */
export function SkeletonAvatar({ className, size = 'md' }: SkeletonProps & { size?: 'sm' | 'md' | 'lg' }) {
    const sizes = {
        sm: 'w-8 h-8',
        md: 'w-10 h-10',
        lg: 'w-16 h-16',
    };

    return <Skeleton className={cn("rounded-full", sizes[size], className)} />;
}

/**
 * Card skeleton with header and content
 */
export function SkeletonCard({ className }: SkeletonProps) {
    return (
        <div className={cn("card-retro p-6 bg-card space-y-4", className)}>
            <div className="flex items-center gap-4">
                <Skeleton className="w-12 h-12 rounded-sm" />
                <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-3 w-1/2" />
                </div>
            </div>
            <div className="space-y-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
            </div>
        </div>
    );
}

/**
 * Stats card skeleton
 */
export function SkeletonStat({ className }: SkeletonProps) {
    return (
        <div className={cn("card-retro p-6 bg-card", className)}>
            <div className="flex justify-between items-start mb-4">
                <Skeleton className="w-10 h-10 rounded-sm" />
                <Skeleton className="w-12 h-4" />
            </div>
            <Skeleton className="h-8 w-24 mb-2" />
            <Skeleton className="h-3 w-20" />
        </div>
    );
}

/**
 * Table row skeleton
 */
export function SkeletonTableRow({ columns = 4 }: { columns?: number }) {
    return (
        <tr className="border-b border-border">
            {Array.from({ length: columns }).map((_, i) => (
                <td key={i} className="py-4 px-4">
                    <Skeleton className="h-4 w-full" />
                </td>
            ))}
        </tr>
    );
}

/**
 * Table skeleton with header and rows
 */
export function SkeletonTable({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
    return (
        <div className="card-retro overflow-hidden">
            <table className="w-full">
                <thead className="bg-secondary border-b border-border">
                    <tr>
                        {Array.from({ length: columns }).map((_, i) => (
                            <th key={i} className="py-3 px-4 text-left">
                                <Skeleton className="h-4 w-20" />
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {Array.from({ length: rows }).map((_, i) => (
                        <SkeletonTableRow key={i} columns={columns} />
                    ))}
                </tbody>
            </table>
        </div>
    );
}

/**
 * Dashboard stats grid skeleton
 */
export function SkeletonStatsGrid({ count = 4 }: { count?: number }) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: count }).map((_, i) => (
                <SkeletonStat key={i} />
            ))}
        </div>
    );
}

/**
 * Chart skeleton
 */
export function SkeletonChart({ className }: SkeletonProps) {
    return (
        <div className={cn("card-retro p-6 bg-card", className)}>
            <div className="flex justify-between items-center mb-6">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-6 w-20" />
            </div>
            <div className="flex items-end justify-between gap-2 h-48">
                {Array.from({ length: 7 }).map((_, i) => (
                    <Skeleton
                        key={i}
                        className="flex-1"
                        style={{ height: `${20 + Math.random() * 60}%` }}
                    />
                ))}
            </div>
            <div className="flex justify-between mt-4">
                {Array.from({ length: 7 }).map((_, i) => (
                    <Skeleton key={i} className="h-3 w-8" />
                ))}
            </div>
        </div>
    );
}

/**
 * List item skeleton
 */
export function SkeletonListItem({ className }: SkeletonProps) {
    return (
        <div className={cn("flex items-center gap-4 p-4 border-b border-border", className)}>
            <SkeletonAvatar size="sm" />
            <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-2/3" />
            </div>
            <Skeleton className="h-8 w-20" />
        </div>
    );
}

/**
 * Dashboard page skeleton
 */
export function SkeletonDashboard() {
    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex justify-between items-center">
                <div className="space-y-2">
                    <Skeleton className="h-8 w-48" />
                    <Skeleton className="h-4 w-32" />
                </div>
                <Skeleton className="h-10 w-32" />
            </div>

            {/* Stats Grid */}
            <SkeletonStatsGrid count={4} />

            {/* Chart and Activity */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                    <SkeletonChart />
                </div>
                <div className="card-retro p-6 bg-card">
                    <Skeleton className="h-5 w-32 mb-6" />
                    <div className="space-y-4">
                        {Array.from({ length: 5 }).map((_, i) => (
                            <div key={i} className="flex items-center gap-3">
                                <Skeleton className="w-2 h-2 rounded-full" />
                                <Skeleton className="h-4 flex-1" />
                                <Skeleton className="h-3 w-12" />
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default Skeleton;
