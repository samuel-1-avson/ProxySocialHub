"use client";

import React, { useState } from "react";
import { ActionCard } from "@/components/ui/ActionCard";
import { Globe, Server, ArrowRight, CheckCircle2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/lib/auth";

export function NewUserDashboard() {
    const { user } = useAuth();
    const [selectedRole, setSelectedRole] = useState<"consumer" | "provider" | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // In a real app, this would call an API to update the user's role
    // For now, since we have no mock data or a direct update role API mentioned,
    // we just simulate the selection state to provide a complete UX flow.
    const handleRoleSelect = async (role: "consumer" | "provider") => {
        setSelectedRole(role);
        setIsSubmitting(true);
        // Simulate API call
        setTimeout(() => {
            // Once updated, the useRole() hook in the parent should trigger 
            // a re-render of the appropriate dashboard.
            window.location.reload(); 
        }, 1500);
    };

    return (
        <div className="min-h-[80vh] flex flex-col items-center justify-center p-4">
            <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="max-w-3xl w-full text-center space-y-8"
            >
                <div className="space-y-4">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-bold uppercase tracking-widest border border-primary/20">
                        Welcome to ProxyHubb
                    </div>
                    <h1 className="text-4xl md:text-5xl font-black tracking-tight">
                        How will you use the network?
                    </h1>
                    <p className="text-lg text-muted-foreground max-w-xl mx-auto">
                        Choose your primary goal. Don't worry, you can always change this later or use both features from your settings.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left mt-12 bg-white/5 p-2 rounded-3xl border border-white/10">
                    <div className="relative group">
                        <ActionCard
                            title="I want to Use Proxies"
                            description="Access high-quality, decentralized residential IP bandwidth from around the world to browse securely or run automated tasks."
                            icon={Globe}
                            ctaLabel="Start Browsing"
                            variant="brand"
                            onClick={() => handleRoleSelect("consumer")}
                        />
                        <AnimatePresence>
                            {selectedRole === "consumer" && (
                                <motion.div 
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    className="absolute inset-0 bg-primary/90 backdrop-blur-sm rounded-2xl flex flex-col items-center justify-center text-primary-foreground z-10"
                                >
                                    <CheckCircle2 size={48} className="mb-4 animate-bounce" />
                                    <p className="font-bold text-lg">Setting up your workspace...</p>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    <div className="relative group">
                        <ActionCard
                            title="I want to Provide Proxies"
                            description="Share your unused internet bandwidth by running a node on your device and earn SOL passively for every GB you share."
                            icon={Server}
                            ctaLabel="Start Earning"
                            variant="provider"
                            onClick={() => handleRoleSelect("provider")}
                        />
                        <AnimatePresence>
                            {selectedRole === "provider" && (
                                <motion.div 
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    className="absolute inset-0 bg-purple-600/90 backdrop-blur-sm rounded-2xl flex flex-col items-center justify-center text-white z-10"
                                >
                                    <CheckCircle2 size={48} className="mb-4 animate-bounce" />
                                    <p className="font-bold text-lg">Preparing your command center...</p>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>

                <div className="pt-8">
                    <p className="text-sm text-muted-foreground">
                        Not sure? <button className="text-primary hover:underline font-medium">Read our guide</button> to see what fits you best.
                    </p>
                </div>
            </motion.div>
        </div>
    );
}
