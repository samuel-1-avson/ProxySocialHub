"use client";

import React from "react";
import { LucideIcon, ArrowRight } from "lucide-react";
import Link from "next/link";
import { motion } from "framer-motion";

interface ActionCardProps {
    title: string;
    description: string;
    icon: LucideIcon;
    href?: string;
    onClick?: () => void;
    ctaLabel?: string;
    variant?: "default" | "brand" | "provider";
}

export function ActionCard({ 
    title, 
    description, 
    icon: Icon, 
    href, 
    onClick, 
    ctaLabel = "Action",
    variant = "default"
}: ActionCardProps) {
    const isBrand = variant === "brand";
    const isProvider = variant === "provider";
    
    const cardContent = (
        <motion.div 
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className={`p-6 rounded-lg border transition-all h-full flex flex-col cursor-pointer group ${
                isBrand ? "bg-primary/5 hover:bg-primary/10 border-primary/20 hover:border-primary/40" : 
                isProvider ? "bg-primary/5 hover:bg-primary/10 border-primary/20 hover:border-primary/40" :
                "glass-card hover:bg-secondary"
            }`}
        >
            <div className={`w-12 h-12 rounded-lg flex items-center justify-center mb-4 ${
                isBrand ? "bg-primary/20 text-primary" : 
                isProvider ? "bg-primary/20 text-primary" :
                "bg-secondary text-foreground"
            }`}>
                <Icon size={24} strokeWidth={1.5} />
            </div>
            
            <h3 className="text-lg font-bold mb-2 text-foreground font-sans">{title}</h3>
            <p className="text-sm text-muted-foreground mb-6 flex-1 pr-4 leading-relaxed">{description}</p>
            
            <div className={`flex items-center gap-2 text-sm font-bold transition-all mt-auto ${
                isBrand ? "text-primary group-hover:translate-x-1" : 
                isProvider ? "text-primary group-hover:translate-x-1" :
                "text-muted-foreground group-hover:text-foreground group-hover:translate-x-1"
            }`}>
                {ctaLabel} <ArrowRight size={16} />
            </div>
        </motion.div>
    );

    if (href) {
        return <Link href={href} className="block h-full">{cardContent}</Link>;
    }

    return <div onClick={onClick} className="h-full">{cardContent}</div>;
}
