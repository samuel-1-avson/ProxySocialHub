"use client";

import { useAuth } from "@/lib/auth";
import { User, Bell, Shield, Smartphone, ArrowRight, Save } from "lucide-react";

export default function SettingsPage() {
    const { user } = useAuth();

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Header */}
            <div className="border-b border-border pb-6">
                <h1 className="text-3xl font-bold font-mono uppercase tracking-tight mb-2">System Configuration</h1>
                <p className="text-muted-foreground font-mono text-xs">MANAGE PROTOCOL PARAMETERS AND IDENTITY LINK.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                {/* Settings Navigation */}
                <div className="space-y-2">
                    {[
                        { label: "General", icon: User, active: true },
                        { label: "Notifications", icon: Bell, active: false },
                        { label: "Security", icon: Shield, active: false },
                        { label: "Devices", icon: Smartphone, active: false },
                    ].map((item) => (
                        <button
                            key={item.label}
                            className={`w-full flex items-center gap-3 px-4 py-3 rounded-sm transition-all border-2 ${item.active
                                    ? "bg-primary text-primary-foreground border-foreground font-bold shadow-[2px_2px_0px_var(--foreground)]"
                                    : "bg-card border-transparent hover:border-border text-muted-foreground hover:text-foreground"
                                }`}
                        >
                            <item.icon size={16} />
                            <span className="font-mono text-xs uppercase tracking-wide">{item.label}</span>
                        </button>
                    ))}
                </div>

                {/* Settings Content */}
                <div className="lg:col-span-3 space-y-6">
                    <div className="card-retro p-8 bg-card">
                        <h2 className="text-xl font-bold font-mono uppercase mb-6 flex items-center gap-2">
                            <User size={20} className="text-primary" />
                            Identity Parameters
                        </h2>

                        <div className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <label className="text-xs font-mono font-bold uppercase text-muted-foreground">Display Name</label>
                                    <input
                                        type="text"
                                        defaultValue={user?.email?.split('@')[0] || "Operator"}
                                        className="w-full bg-background border border-border rounded-sm py-2 px-3 text-sm font-mono focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-mono font-bold uppercase text-muted-foreground">Email Uplink</label>
                                    <input
                                        type="email"
                                        defaultValue={user?.email || ""}
                                        disabled
                                        className="w-full bg-secondary/20 border border-border rounded-sm py-2 px-3 text-sm font-mono opacity-60 cursor-not-allowed"
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-mono font-bold uppercase text-muted-foreground">Bio / Status</label>
                                <textarea
                                    rows={3}
                                    defaultValue="Ready to process bandwidth."
                                    className="w-full bg-background border border-border rounded-sm py-2 px-3 text-sm font-mono focus:border-primary focus:ring-1 focus:ring-primary outline-none resize-none"
                                />
                            </div>
                        </div>

                        <div className="mt-8 pt-6 border-t border-border flex justify-end">
                            <button className="btn-retro btn-retro-primary py-2 px-6 text-xs flex items-center gap-2">
                                <Save size={14} />
                                SAVE CHANGES
                            </button>
                        </div>
                    </div>

                    <div className="card-retro p-8 bg-card border-red-500/20">
                        <h2 className="text-xl font-bold font-mono uppercase mb-4 text-destructive flex items-center gap-2">
                            <Shield size={20} />
                            Danger Zone
                        </h2>
                        <div className="flex items-center justify-between p-4 border border-destructive/20 bg-destructive/5 rounded-sm">
                            <div>
                                <p className="font-bold font-mono text-sm text-destructive">Terminate Link</p>
                                <p className="text-xs text-muted-foreground font-mono mt-1">PERMANENTLY DELETE ACCOUNT AND DATA.</p>
                            </div>
                            <button className="btn-retro bg-destructive text-destructive-foreground hover:bg-destructive/90 py-2 px-4 text-xs font-bold border-2 border-destructive-foreground">
                                DELETE
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
