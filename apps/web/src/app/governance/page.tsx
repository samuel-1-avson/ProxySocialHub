"use client";

import { Vote, Hammer } from "lucide-react";

export default function GovernancePage() {
    return (
        <div className="min-h-[60vh] flex flex-col items-center justify-center text-center space-y-6">
            <div className="w-24 h-24 rounded-full bg-secondary/30 border-2 border-dashed border-border flex items-center justify-center">
                <Vote size={48} className="text-muted-foreground opacity-50" />
            </div>
            <div>
                <h1 className="text-2xl font-bold font-mono uppercase mb-2">DAO Governance</h1>
                <p className="text-muted-foreground font-mono text-sm max-w-md mx-auto">
                    VOTING MODULE AND PROPOSAL SYSTEM CURRENTLY OFFLINE.
                </p>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 bg-yellow-500/10 border border-yellow-500/20 text-yellow-600 rounded-sm">
                <Hammer size={16} />
                <span className="text-xs font-bold font-mono uppercase">Construction in Progress</span>
            </div>
        </div>
    );
}
