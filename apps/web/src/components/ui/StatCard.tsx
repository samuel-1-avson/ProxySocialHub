"use client";

import React from "react";
import { LucideIcon } from "lucide-react";
import { motion } from "framer-motion";

interface StatCardProps {
    title: string;
    value: React.ReactNode;
    subtitle?: string;
    icon: LucideIcon;
    trendComponent?: React.ReactNode;
    variant?: "default" | "success" | "warning" | "error" | "brand";
    loading?: boolean;
}

const variantStyles = {
    default: "text-muted-foreground",
    success: "text-success",
    warning: "text-warning",
    error: "text-destructive",
    brand: "text-primary",
};

export function StatCard({ 
    title, 
    value, 
    subtitle, 
    icon: Icon, 
    trendComponent, 
    variant = "default",
    loading = false 
}: StatCardProps) {
    return (
        <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-6 rounded-lg glass-card relative overflow-hidden group"
        >
            <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-radial opacity-10 blur-2xl rounded-full translate-x-10 -translate-y-10 transition-transform group-hover:scale-150 ${
                variant === 'success' ? 'from-success to-transparent' : 
                variant === 'warning' ? 'from-warning to-transparent' : 
                variant === 'error' ? 'from-destructive to-transparent' : 
                variant === 'brand' ? 'from-primary to-transparent' : 
                'from-white/20 to-transparent'
            }`} />
            
            <div className="flex justify-between items-start mb-4 relative z-10">
                <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
                <div className={`p-2 rounded-lg bg-secondary ${variantStyles[variant]}`}>
                    <Icon size={20} strokeWidth={1.5} />
                </div>
            </div>
            
            <div className="relative z-10">
                {loading ? (
                    <div className="h-10 w-24 bg-secondary animate-pulse rounded-lg mb-1" />
                ) : (
                    <div className="text-3xl font-bold font-sans tracking-tight text-foreground">{value}</div>
                )}
                
                <div className="flex items-center gap-2 mt-2">
                    {trendComponent}
                    {subtitle && !loading && (
                        <span className="text-xs text-muted-foreground truncate">{subtitle}</span>
                    )}
                    {loading && (
                        <div className="h-4 w-32 bg-secondary animate-pulse rounded" />
                    )}
                </div>
            </div>
        </motion.div>
    );
}
