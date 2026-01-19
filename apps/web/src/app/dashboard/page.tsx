"use client";

import { useAuth } from "@/lib/auth";
import { ArrowUpRight, ArrowDownRight, Activity, Wifi, Server, DollarSign, Clock } from "lucide-react";
import Link from "next/link";

export default function DashboardPage() {
    const { user } = useAuth();

    const stats = [
        { label: "Active Nodes", value: "3", icon: Server, change: "+1", trend: "up", color: "text-blue-500" },
        { label: "Bandwidth Shared", value: "124.5 GB", icon: Wifi, change: "+12%", trend: "up", color: "text-green-500" },
        { label: "Earnings", value: "₵ 450.00", icon: DollarSign, change: "+8.5%", trend: "up", color: "text-yellow-500" },
        { label: "Uptime", value: "99.8%", icon: Clock, change: "-0.1%", trend: "down", color: "text-purple-500" },
    ];

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold font-mono uppercase tracking-tight mb-1">System Overview</h1>
                    <p className="text-muted-foreground font-mono text-xs">WELCOME BACK, OPERATOR</p>
                </div>
                <div className="flex gap-3">
                    <button className="btn-retro btn-retro-outline text-xs py-2">
                        Export Log
                    </button>
                    <button className="btn-retro btn-retro-primary text-xs py-2">
                        Deploy Node
                    </button>
                </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {stats.map((stat, i) => (
                    <div key={i} className="card-retro p-6 bg-card hover:-translate-y-1 transition-transform cursor-default">
                        <div className="flex justify-between items-start mb-4">
                            <div className={`p-2 rounded-sm border border-border bg-background ${stat.color}`}>
                                <stat.icon size={20} />
                            </div>
                            {stat.trend === "up" ? (
                                <div className="flex items-center text-green-500 text-xs font-bold font-mono">
                                    <ArrowUpRight size={14} />
                                    {stat.change}
                                </div>
                            ) : (
                                <div className="flex items-center text-red-500 text-xs font-bold font-mono">
                                    <ArrowDownRight size={14} />
                                    {stat.change}
                                </div>
                            )}
                        </div>
                        <div className="text-2xl font-bold font-mono mb-1">{stat.value}</div>
                        <div className="text-xs text-muted-foreground uppercase font-mono tracking-wider">{stat.label}</div>
                    </div>
                ))}
            </div>

            {/* Recent Activity & Network Status */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Network Graph Placeholder */}
                <div className="lg:col-span-2 card-retro p-0 bg-card flex flex-col">
                    <div className="p-6 border-b border-border flex justify-between items-center">
                        <h3 className="font-bold font-mono uppercase">Traffic Analysis</h3>
                        <div className="flex gap-2 text-xs font-mono">
                            <span className="px-2 py-1 bg-primary/10 text-primary rounded-sm border border-primary/20 cursor-pointer">24H</span>
                            <span className="px-2 py-1 text-muted-foreground hover:bg-accent rounded-sm cursor-pointer">7D</span>
                            <span className="px-2 py-1 text-muted-foreground hover:bg-accent rounded-sm cursor-pointer">30D</span>
                        </div>
                    </div>
                    <div className="flex-1 min-h-[300px] bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] relative flex items-center justify-center">

                        {/* Simulated Graph Lines */}
                        <div className="absolute inset-0 flex items-end justify-between px-8 py-8 gap-2 opacity-50">
                            {[30, 45, 35, 50, 65, 40, 55, 70, 60, 80, 75, 90, 85, 60, 50].map((h, i) => (
                                <div key={i} style={{ height: `${h}%` }} className="w-full bg-primary/20 border-t-2 border-primary rounded-t-sm hover:bg-primary/40 transition-colors"></div>
                            ))}
                        </div>

                        <div className="bg-background/80 backdrop-blur-sm border border-border p-4 rounded-sm text-center z-10">
                            <Activity className="w-8 h-8 text-primary mx-auto mb-2 animate-pulse" />
                            <p className="font-mono text-xs font-bold">LIVE METRICS ACTIVE</p>
                        </div>
                    </div>
                </div>

                {/* Recent Events */}
                <div className="card-retro p-0 bg-card flex flex-col">
                    <div className="p-6 border-b border-border">
                        <h3 className="font-bold font-mono uppercase">System Logs</h3>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[400px]">
                        {[
                            { msg: "Wallet deposit confirmed", time: "2 min ago", type: "success" },
                            { msg: "Node Proxy-01 connected", time: "15 min ago", type: "info" },
                            { msg: "High latency detected", time: "1 hour ago", type: "warn" },
                            { msg: "Session #8821 terminated", time: "3 hours ago", type: "info" },
                            { msg: "Weekly payout processed", time: "1 day ago", type: "success" },
                        ].map((log, i) => (
                            <div key={i} className="flex gap-3 items-start p-3 hover:bg-accent/50 rounded-sm transition-colors border border-transparent hover:border-border/50">
                                <div className={`w-2 h-2 mt-1.5 rounded-full shrink-0 ${log.type === 'success' ? 'bg-green-500' :
                                        log.type === 'warn' ? 'bg-yellow-500' : 'bg-blue-500'
                                    }`} />
                                <div>
                                    <p className="text-sm font-medium leading-none mb-1">{log.msg}</p>
                                    <p className="text-[10px] font-mono text-muted-foreground">{log.time}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="p-4 border-t border-border bg-secondary/10">
                        <Link href="/logs" className="block text-center text-xs font-mono font-bold text-primary hover:underline uppercase">
                            View Full History
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
