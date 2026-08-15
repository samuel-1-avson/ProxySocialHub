"use client";

import React from "react";
import { useAuth } from "@/lib/auth";
import { useRole } from "@/hooks/useRole";
import { Server, Globe, ArrowRightLeft } from "lucide-react";

export function WorkspaceSwitcher({ isCollapsed }: { isCollapsed: boolean }) {
    const { user } = useAuth();
    const { isDualRole, role } = useRole();

    // If the user isn't dual role, we don't show the switcher at all
    if (!isDualRole) return null;

    void user;

    return (
        <div className={`px-4 py-3 border-b border-border bg-muted/50 transition-all duration-300`}>
            {isCollapsed ? (
                <div className="flex justify-center" title="Dual Role (Buyer & Provider)">
                    <ArrowRightLeft className="w-5 h-5 text-primary" />
                </div>
            ) : (
                <div className="flex items-center justify-between p-1 bg-background rounded-xl border border-border">
                    <button className={`flex-1 flex items-center justify-center gap-2 py-1.5 px-2 rounded-lg text-[10px] font-bold uppercase transition-all ${
                        role === 'both' ? 'bg-primary/15 text-primary border border-primary/25' : 'text-muted-foreground hover:text-foreground'
                    }`}>
                        <Globe className="w-3 h-3" />
                        Buyer
                    </button>
                    <button className={`flex-1 flex items-center justify-center gap-2 py-1.5 px-2 rounded-lg text-[10px] font-bold uppercase transition-all ${
                        role === 'both' ? 'bg-purple-500/15 text-purple-700 dark:text-purple-400 border border-purple-500/25' : 'text-muted-foreground hover:text-foreground'
                    }`}>
                        <Server className="w-3 h-3" />
                        Provider
                    </button>
                </div>
            )}
        </div>
    );
}
