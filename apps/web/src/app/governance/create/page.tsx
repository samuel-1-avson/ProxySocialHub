"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createProposal } from "@/lib/services/governance";
import { ArrowLeft, Loader2, Save, AlertTriangle, Hexagon, Terminal, Cpu, Info, ShieldCheck, Plus, FileText } from "lucide-react";
import { motion } from "framer-motion";
import { GlassCard } from "@/components/ui/glass-card";

export default function CreateProposalPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({
        title: "",
        description: "",
        type: "parameter_change",
        executionData: "{}",
    });
    const [error, setError] = useState("");

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setLoading(true);

        try {
            let parsedData = {};
            try {
                parsedData = JSON.parse(formData.executionData);
            } catch {
                throw new Error("Invalid JSON in Execution Data");
            }

            await createProposal(formData.title, formData.description, formData.type, parsedData);
            router.push("/governance");
        } catch (err) {
            console.error("Failed to create proposal", err);
            setError(err instanceof Error ? err.message : "Failed to create proposal");
        } finally {
            setLoading(false);
        }
    };

    const containerVariants = {
        hidden: { opacity: 0, y: 20 },
        show: {
            opacity: 1,
            y: 0,
            transition: { duration: 0.4, ease: "easeOut" } as any
        }
    };

    return (
        <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="show"
            className="max-w-3xl mx-auto space-y-10 pb-20 font-mono"
        >
            <button
                onClick={() => router.back()}
                className="group flex items-center gap-3 text-[10px] font-black tracking-[0.2em] text-muted-foreground/40 hover:text-primary transition-all uppercase"
            >
                <div className="p-2 rounded-lg bg-white/2 border border-white/5 group-hover:border-primary/40 group-hover:bg-primary/5 transition-all">
                    <ArrowLeft size={14} />
                </div>
                Return to Command
            </button>

            <div className="space-y-4">
                <div className="flex items-center gap-2 text-primary text-[10px] font-black uppercase tracking-[0.4em]">
                    <Plus size={12} /> Sequence Initialization
                </div>
                <div>
                    <h1 className="text-4xl font-black uppercase tracking-tighter leading-none bg-clip-text text-transparent bg-gradient-to-r from-primary to-emerald-400">Create Proposal</h1>
                    <p className="text-muted-foreground/40 font-mono text-[10px] mt-3 uppercase tracking-widest max-w-lg">
                        Submit a new protocol adjustment or community signal. On-chain validation required for execution.
                    </p>
                </div>
            </div>

            <GlassCard className="!p-10 border-white/10 relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-10 opacity-5 pointer-events-none group-hover:scale-110 transition-transform">
                    <Cpu size={180} />
                </div>

                <form onSubmit={handleSubmit} className="space-y-8 relative z-10">
                    <div className="space-y-3">
                        <label className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground/60 flex items-center gap-2">
                            <Hexagon size={12} className="text-primary" /> Proposal Title
                        </label>
                        <input
                            type="text"
                            name="title"
                            value={formData.title}
                            onChange={handleChange}
                            required
                            className="w-full bg-black/40 border border-white/5 p-4 rounded-xl font-black text-sm text-foreground focus:border-primary/50 focus:outline-none transition-all placeholder:text-white/5"
                            placeholder="e.g. NETWORK_REWARD_ADJUSTMENT_V2"
                        />
                    </div>

                    <div className="grid md:grid-cols-2 gap-8">
                        <div className="space-y-3">
                            <label className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground/60 flex items-center gap-2">
                                <Terminal size={12} className="text-primary" /> Transmission Type
                            </label>
                            <div className="relative">
                                <select
                                    name="type"
                                    value={formData.type}
                                    onChange={handleChange}
                                    className="w-full bg-black/40 border border-white/5 p-4 rounded-xl font-black text-xs text-foreground focus:border-primary/50 focus:outline-none appearance-none transition-all cursor-pointer"
                                >
                                    <option value="parameter_change">PARAMETER_ADJUSTMENT</option>
                                    <option value="upgrade">PROTOCOL_UPGRADE</option>
                                    <option value="treasury">TREASURY_SPEND</option>
                                    <option value="text">SIGNAL_PROPOSAL</option>
                                </select>
                                <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none opacity-20">
                                    <ArrowLeft size={16} className="-rotate-90" />
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center pt-8">
                            <div className="flex items-center gap-3 p-4 bg-white/2 border border-white/5 rounded-xl w-full">
                                <Info size={16} className="text-primary/40" />
                                <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/40 leading-tight">
                                    Protocol adjustments require automated settlement data.
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <label className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground/60 flex items-center gap-2">
                            <FileText size={12} className="text-primary" /> Sequence Documentation
                        </label>
                        <textarea
                            name="description"
                            value={formData.description}
                            onChange={handleChange}
                            required
                            rows={6}
                            className="w-full bg-black/40 border border-white/5 p-4 rounded-xl font-black text-xs text-foreground focus:border-primary/50 focus:outline-none transition-all placeholder:text-white/5 resize-none leading-relaxed"
                            placeholder="Detailed technical specification and rationale for this consensus adjustment..."
                        />
                    </div>

                    <div className="space-y-3">
                        <label className="text-[10px] font-black uppercase tracking-[0.4em] text-muted-foreground/60 flex items-center justify-between">
                            <span className="flex items-center gap-2"><Cpu size={12} className="text-primary" /> Execution Payload</span>
                            <span className="px-3 py-1 bg-primary/10 text-primary border border-primary/20 rounded-lg text-[8px] font-black">ADVANCED_MODE</span>
                        </label>
                        <textarea
                            name="executionData"
                            value={formData.executionData}
                            onChange={handleChange}
                            rows={4}
                            className="w-full bg-black/40 border border-white/5 p-5 rounded-xl font-mono text-[10px] text-primary/80 focus:border-primary/50 focus:outline-none transition-all placeholder:text-white/5"
                        />
                        <div className="flex items-start gap-3 p-4 bg-primary/5 border border-primary/10 rounded-xl">
                            <ShieldCheck size={16} className="text-primary shrink-0" />
                            <p className="text-[9px] text-muted-foreground/60 font-black uppercase tracking-widest leading-relaxed">
                                Payload is parsed on-chain. Verification failure will result in automatic rejection.
                                For non-executable text signals, use <code className="bg-black/40 px-1.5 py-0.5 rounded border border-white/5">{"{}"}</code>.
                            </p>
                        </div>
                    </div>

                    {error && (
                        <div className="p-5 bg-rose-500/10 border border-rose-500/20 text-rose-500 text-[10px] font-black uppercase tracking-widest flex items-center gap-3 rounded-xl animate-pulse">
                            <AlertTriangle size={18} />
                            Sequence Error: {error}
                        </div>
                    )}

                    <div className="pt-10 border-t border-white/5 space-y-4">
                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full py-5 bg-primary text-primary-foreground rounded-2xl font-black text-xs uppercase tracking-[0.4em] flex items-center justify-center gap-3 hover:shadow-[0_0_40px_rgba(16,185,129,0.4)] transition-all active:scale-[0.98] disabled:opacity-50"
                        >
                            {loading ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                            {loading ? "Initializing Authority Link..." : "Publish On-Chain Sequence"}
                        </button>
                        <p className="text-[9px] text-center font-black uppercase tracking-[0.3em] text-muted-foreground/20 leading-relaxed max-w-sm mx-auto">
                            INITIALIZATION REQUIRES A 100 PROX STAKE DEPOSIT.
                            RESOURCES WILL BE RETURNED UPON QUORUM SUCCESS.
                        </p>
                    </div>
                </form>
            </GlassCard>
        </motion.div>
    );
}
