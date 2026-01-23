"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createProposal } from "@/lib/services/governance";
import { ArrowLeft, Loader2, Save, AlertTriangle } from "lucide-react";

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

    return (
        <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in duration-500">
            <button onClick={() => router.back()} className="flex items-center gap-2 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors">
                <ArrowLeft size={14} />
                BACK TO GOVERNANCE
            </button>

            <div>
                <h1 className="text-3xl font-bold font-mono uppercase tracking-tight mb-2">Create Proposal</h1>
                <p className="text-muted-foreground font-mono text-xs">
                    SUBMIT A NEW PROPOSAL FOR COMMUNITY VOTING. REQUIRES MINIMUM STAKE.
                </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-2">
                    <label className="text-xs font-bold font-mono uppercase">Title</label>
                    <input
                        type="text"
                        name="title"
                        value={formData.title}
                        onChange={handleChange}
                        required
                        className="w-full bg-secondary/10 border border-border p-3 rounded-sm font-mono text-sm focus:border-primary focus:outline-none"
                        placeholder="E.g. Increase Max Nodes per User"
                    />
                </div>

                <div className="space-y-2">
                    <label className="text-xs font-bold font-mono uppercase">Type</label>
                    <select
                        name="type"
                        value={formData.type}
                        onChange={handleChange}
                        className="w-full bg-secondary/10 border border-border p-3 rounded-sm font-mono text-sm focus:border-primary focus:outline-none appearance-none"
                    >
                        <option value="parameter_change">Parameter Adjustment</option>
                        <option value="upgrade">Protocol Upgrade</option>
                        <option value="treasury">Treasury Spend</option>
                        <option value="text">Text Proposal (Signal)</option>
                    </select>
                </div>

                <div className="space-y-2">
                    <label className="text-xs font-bold font-mono uppercase">Description</label>
                    <textarea
                        name="description"
                        value={formData.description}
                        onChange={handleChange}
                        required
                        rows={6}
                        className="w-full bg-secondary/10 border border-border p-3 rounded-sm font-mono text-sm focus:border-primary focus:outline-none"
                        placeholder="Detailed explanation of the proposal..."
                    />
                </div>

                <div className="space-y-2">
                    <label className="text-xs font-bold font-mono uppercase flex items-center justify-between">
                        <span>Execution Data (JSON)</span>
                        <span className="text-[10px] text-muted-foreground">Advanced</span>
                    </label>
                    <textarea
                        name="executionData"
                        value={formData.executionData}
                        onChange={handleChange}
                        rows={4}
                        className="w-full bg-secondary/10 border border-border p-3 rounded-sm font-mono text-xs focus:border-primary focus:outline-none font-mono"
                    />
                    <p className="text-[10px] text-muted-foreground font-mono">
                        Valid JSON payload required for automated execution. Use <code className="bg-secondary/20 px-1 rounded">{"{}"}</code> for signal proposals.
                    </p>
                </div>

                {error && (
                    <div className="p-4 bg-destructive/10 border border-destructive/20 text-destructive text-xs font-bold font-mono flex items-center gap-2 rounded-sm">
                        <AlertTriangle size={16} />
                        {error}
                    </div>
                )}

                <div className="pt-4 border-t border-border">
                    <button
                        type="submit"
                        disabled={loading}
                        className="btn-retro btn-retro-primary w-full py-3 flex items-center justify-center gap-2"
                    >
                        {loading ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                        {loading ? "SUBMITTING ON-CHAIN..." : "PUBLISH PROPOSAL"}
                    </button>
                    <p className="text-[10px] text-center font-mono text-muted-foreground mt-3">
                        Proposal creation requires a deposit of 100 PROX which will be returned if the proposal passes.
                    </p>
                </div>
            </form>
        </div>
    );
}
