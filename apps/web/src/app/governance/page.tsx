"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { getProposals, type Proposal } from "@/lib/services/governance";
import { Vote, Hammer, Plus, Clock, CheckCircle, XCircle, FileText, Loader2, ArrowRight } from "lucide-react";

export default function GovernancePage() {
    const [proposals, setProposals] = useState<Proposal[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function loadProposals() {
            try {
                const data = await getProposals();
                setProposals(data);
            } catch (err) {
                console.error("Failed to load proposals", err);
            } finally {
                setLoading(false);
            }
        }
        loadProposals();
    }, []);

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'active': return 'text-primary border-primary';
            case 'passed': return 'text-green-500 border-green-500';
            case 'rejected': return 'text-red-500 border-red-500';
            case 'executed': return 'text-blue-500 border-blue-500';
            default: return 'text-muted-foreground border-border';
        }
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 border-b border-border pb-6">
                <div>
                    <h1 className="text-3xl font-bold font-mono uppercase tracking-tight mb-2">DAO Governance</h1>
                    <p className="text-muted-foreground font-mono text-xs max-w-lg">
                        PARTICIPATE IN PROTOCOL UPGRADES AND PARAMETER ADJUSTMENTS.
                        YOUR VOTING POWER IS DETERMINED BY YOUR STAKED TOKENS.
                    </p>
                </div>
                <Link
                    href="/governance/create"
                    className="btn-retro btn-retro-primary py-2 px-4 text-xs flex items-center gap-2"
                >
                    <Plus size={16} />
                    NEW PROPOSAL
                </Link>
            </div>

            {/* Voting Power / Stats Banner */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="card-retro p-6 bg-card flex items-center justify-between">
                    <div>
                        <div className="text-[10px] font-mono font-bold uppercase text-muted-foreground mb-1">My Voting Power</div>
                        <div className="text-2xl font-bold font-mono text-primary">0 VP</div>
                    </div>
                    <Vote className="text-primary opacity-20" size={48} />
                </div>
                <div className="card-retro p-6 bg-card flex items-center justify-between">
                    <div>
                        <div className="text-[10px] font-mono font-bold uppercase text-muted-foreground mb-1">Active Proposals</div>
                        <div className="text-2xl font-bold font-mono">{proposals.filter(p => p.status === 'active').length}</div>
                    </div>
                    <Clock className="text-foreground opacity-20" size={48} />
                </div>
                <div className="card-retro p-6 bg-card flex items-center justify-between">
                    <div>
                        <div className="text-[10px] font-mono font-bold uppercase text-muted-foreground mb-1">Total Executed</div>
                        <div className="text-2xl font-bold font-mono">{proposals.filter(p => p.status === 'executed').length}</div>
                    </div>
                    <CheckCircle className="text-green-500 opacity-20" size={48} />
                </div>
            </div>

            {/* Proposals List */}
            <div className="space-y-4">
                <h2 className="text-xl font-bold font-mono uppercase flex items-center gap-2">
                    <FileText size={20} />
                    Proposals
                </h2>

                {loading ? (
                    <div className="py-20 flex justify-center">
                        <Loader2 className="animate-spin text-primary" size={32} />
                    </div>
                ) : proposals.length === 0 ? (
                    <div className="text-center py-20 border-2 border-dashed border-border rounded-sm">
                        <p className="font-mono text-sm text-muted-foreground uppercase">No proposals found.</p>
                    </div>
                ) : (
                    <div className="grid gap-4">
                        {proposals.map((proposal) => (
                            <Link
                                key={proposal.id}
                                href={`/governance/${proposal.id}`}
                                className="card-retro p-6 bg-card hover:border-primary transition-all group group-hover:translate-x-1"
                            >
                                <div className="flex justify-between items-start">
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-3">
                                            <span className={`text-[10px] font-bold font-mono uppercase px-2 py-0.5 border rounded-full ${getStatusColor(proposal.status)}`}>
                                                {proposal.status}
                                            </span>
                                            <span className="text-[10px] font-mono text-muted-foreground uppercase">
                                                ID: {proposal.id.split('-')[0]}
                                            </span>
                                        </div>
                                        <h3 className="text-lg font-bold font-mono uppercase group-hover:text-primary transition-colors">
                                            {proposal.title}
                                        </h3>
                                        <p className="text-xs font-mono text-muted-foreground line-clamp-2 max-w-2xl">
                                            {proposal.description}
                                        </p>
                                    </div>
                                    <ArrowRight className="text-muted-foreground group-hover:text-primary opacity-0 group-hover:opacity-100 transition-all transform group-hover:translate-x-2" />
                                </div>
                                <div className="mt-4 pt-4 border-t border-border flex justify-between items-center">
                                    <div className="text-[10px] font-mono uppercase text-muted-foreground">
                                        Ends: {new Date(proposal.end_time).toLocaleDateString()}
                                    </div>
                                    <div className="text-[10px] font-mono uppercase font-bold text-foreground">
                                        {proposal.total_votes} Votes
                                    </div>
                                </div>
                            </Link>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
