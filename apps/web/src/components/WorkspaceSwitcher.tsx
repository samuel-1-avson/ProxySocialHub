"use client";

import React from "react";
import { useAuth } from "@/lib/auth";
import { useRole } from "@/hooks/useRole";
import { Server, Globe, ArrowRightLeft } from "lucide-react";
import { motion } from "framer-motion";

export function WorkspaceSwitcher({ isCollapsed }: { isCollapsed: boolean }) {
    const { user } = useAuth();
    const { isDualRole, role } = useRole();

    // If the user isn't dual role, we don't show the switcher at all
    if (!isDualRole) return null;

    // A real implementation might let the user click to swap their "active" viewing role 
    // by storing it in a UI state, but for now we just show their global "both" capability.
    // Assuming "both" means they see everything for now, or we can toggle a local state
    // in UIStore to filter the sidebar.

    return (
        <div className={`px-4 py-3 border-b border-white/5 bg-white/5 transition-all duration-300`}>
            {isCollapsed ? (
                <div className="flex justify-center" title="Dual Role (Buyer & Provider)">
                    <ArrowRightLeft className="w-5 h-5 text-emerald-400" />
                </div>
            ) : (
                <div className="flex items-center justify-between p-1 bg-black/40 rounded-xl border border-white/10">
                    <button className={`flex-1 flex items-center justify-center gap-2 py-1.5 px-2 rounded-lg text-[10px] font-bold uppercase transition-all ${
                        role === 'both' ? 'bg-primary/20 text-emerald-400 border border-primary/20' : 'text-muted-foreground hover:text-white'
                    }`}>
                        <Globe className="w-3 h-3" />
                        Buyer
                    </button>
                    <button className={`flex-1 flex items-center justify-center gap-2 py-1.5 px-2 rounded-lg text-[10px] font-bold uppercase transition-all ${
                        role === 'both' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/20' : 'text-muted-foreground hover:text-white'
                    }`}>
                        <Server className="w-3 h-3" />
                        Provider
                    </button>
                </div>
            )}
        </div>
    );
}
