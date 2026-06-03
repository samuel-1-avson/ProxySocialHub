"use client";

import { SessionsPanel } from "@/components/security";

export default function DevicesSettingsPage() {
    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500">
            <div>
                <h2 className="text-2xl font-black font-mono uppercase tracking-tighter">Devices & sessions</h2>
                <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mt-1 opacity-60">
                    Terminals currently signed into your account
                </p>
            </div>
            <SessionsPanel />
        </div>
    );
}
