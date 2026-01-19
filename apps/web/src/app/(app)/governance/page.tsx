"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { getProposals, createProposal, castVote, type Proposal } from "@/lib/social-api";
import {
    Vote,
    Plus,
    CheckCircle2,
    XCircle,
    User,
    Calendar,
    Clock,
    Scale,
    AlertCircle
} from "lucide-react";

import { motion } from "framer-motion";

export default function GovernancePage() {
    const { isAuthenticated, user } = useAuth();
    const [proposals, setProposals] = useState<Proposal[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [isVoteOpen, setIsVoteOpen] = useState(false);
    const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null);
    const [activeTab, setActiveTab] = useState("active"); // active, passed, rejected

    // Form states
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [duration] = useState(7); // fixed for now

    const fetchProposals = async () => {
        setLoading(true);
        try {
            const data = await getProposals();
            setProposals(data.proposals || []);
        } catch (err) {
            setError("Failed to load proposals");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchProposals();
    }, []);

    const handleCreateWrapper = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await createProposal({ title, description, duration_days: duration });
            setIsCreateOpen(false);
            setTitle("");
            setDescription("");
            fetchProposals();
        } catch (err) {
            alert("Failed to create proposal");
        }
    };

    const handleVoteWrapper = async (choice: 'yes' | 'no') => {
        if (!selectedProposal) return;
        try {
            const res = await castVote(selectedProposal.id, choice);
            alert(`Vote cast successfully with ${res.power} voting power!`);
            setIsVoteOpen(false);
            fetchProposals();
        } catch (err) {
            alert(err instanceof Error ? err.message : "Failed to vote");
        }
    };

    const filteredProposals = proposals.filter((p) => {
        if (activeTab === "active") return p.status === "active";
        // for passed/rectected, assuming passed includes executed
        if (activeTab === "history") return p.status !== "active";
        return true;
    });

    const calculatePercentage = (yes: number, no: number) => {
        const total = yes + no;
        if (total === 0) return { yes: 0, no: 0 };
        return {
            yes: Math.round((yes / total) * 100),
            no: Math.round((no / total) * 100)
        };
    };

    return (
        <div className="min-h-screen pb-20 relative">
            {/* Background */}
            <div className="fixed inset-0 pointer-events-none z-0">
                <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-900/10 blur-[150px] rounded-full mix-blend-screen"></div>
            </div>

            <div className="relative z-10 max-w-6xl mx-auto space-y-10">

                {/* Header */}
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                    <div>
                        <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight flex items-center gap-4">
                            <Scale className="text-blue-500" size={40} />
                            GOVERNANCE
                        </h1>
                        <p className="text-white/50 mt-2 text-lg">Decentralized decision making powered by TAO.</p>
                    </div>

                    {isAuthenticated && (
                        <button
                            onClick={() => setIsCreateOpen(true)}
                            className="flex items-center gap-2 px-6 py-3 bg-white text-black font-bold rounded-xl hover:bg-zinc-200 transition-colors uppercase tracking-wide"
                        >
                            <Plus size={20} />
                            New Proposal
                        </button>
                    )}
                </div>

                {/* Filters */}
                <div className="flex items-center gap-4 border-b border-white/10 pb-4">
                    <button
                        onClick={() => setActiveTab("active")}
                        className={`text-sm font-bold uppercase tracking-wider px-4 py-2 rounded-lg transition-colors ${activeTab === "active" ? "bg-white/10 text-white" : "text-white/40 hover:text-white"}`}
                    >
                        Active Proposals
                    </button>
                    <button
                        onClick={() => setActiveTab("history")}
                        className={`text-sm font-bold uppercase tracking-wider px-4 py-2 rounded-lg transition-colors ${activeTab === "history" ? "bg-white/10 text-white" : "text-white/40 hover:text-white"}`}
                    >
                        History
                    </button>
                </div>

                {/* Grid */}
                {loading ? (
                    <div className="flex justify-center py-20">
                        <div className="w-10 h-10 border-2 border-white/10 border-t-blue-500 rounded-full animate-spin"></div>
                    </div>
                ) : filteredProposals.length === 0 ? (
                    <div className="text-center py-20 border border-dashed border-white/10 rounded-2xl">
                        <p className="text-white/40">No proposals found.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-6">
                        {filteredProposals.map((proposal) => {
                            const stats = calculatePercentage(proposal.yes_votes, proposal.no_votes);
                            const totalVotes = proposal.yes_votes + proposal.no_votes;

                            return (
                                <motion.div
                                    key={proposal.id}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="bg-[#08080a] border border-white/5 rounded-2xl p-6 hover:border-white/10 transition-all group relative overflow-hidden"
                                >
                                    <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-blue-500 to-purple-500 opacity-0 group-hover:opacity-100 transition-opacity"></div>

                                    <div className="flex flex-col md:flex-row gap-6 justify-between">
                                        <div className="flex-1 space-y-4">
                                            <div className="flex items-center gap-3">
                                                <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wide ${proposal.status === 'active' ? 'bg-green-500/10 text-green-400' :
                                                        proposal.status === 'passed' ? 'bg-blue-500/10 text-blue-400' :
                                                            'bg-red-500/10 text-red-400'
                                                    }`}>
                                                    {proposal.status}
                                                </span>
                                                <span className="text-white/20 text-xs font-mono">#{proposal.id.slice(0, 8)}</span>

                                                {proposal.ipfs_hash && (
                                                    <span className="flex items-center gap-1 px-2 py-1 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded text-[10px] font-mono" title={`IPFS CID: ${proposal.ipfs_hash}`}>
                                                        <span>IPFS</span>
                                                        <span className="opacity-50 hidden sm:inline">{proposal.ipfs_hash.slice(0, 6)}...</span>
                                                    </span>
                                                )}
                                            </div>

                                            <h3 className="text-2xl font-bold text-white group-hover:text-blue-200 transition-colors">
                                                {proposal.title}
                                            </h3>
                                            <p className="text-white/60 line-clamp-2 max-w-2xl text-sm leading-relaxed">
                                                {proposal.description}
                                            </p>

                                            <div className="flex items-center gap-6 text-xs text-white/40 pt-2">
                                                <div className="flex items-center gap-2">
                                                    <User size={14} />
                                                    <span>{proposal.proposer?.username || 'Unknown'}</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <Clock size={14} />
                                                    <span>Ends {new Date(proposal.end_time).toLocaleDateString()}</span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="w-full md:w-64 space-y-4 bg-white/5 rounded-xl p-4 border border-white/5">
                                            <div className="flex justify-between items-end">
                                                <span className="text-xs font-bold text-white/40 uppercase">Current Results</span>
                                                <span className="text-xs text-white/20">{totalVotes.toFixed(1)} VP</span>
                                            </div>

                                            <div className="space-y-3">
                                                <div>
                                                    <div className="flex justify-between text-xs font-medium mb-1">
                                                        <span className="text-green-400">Yes</span>
                                                        <span className="text-white">{stats.yes}%</span>
                                                    </div>
                                                    <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                                                        <div className="h-full bg-green-500 rounded-full" style={{ width: `${stats.yes}%` }}></div>
                                                    </div>
                                                </div>
                                                <div>
                                                    <div className="flex justify-between text-xs font-medium mb-1">
                                                        <span className="text-red-400">No</span>
                                                        <span className="text-white">{stats.no}%</span>
                                                    </div>
                                                    <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                                                        <div className="h-full bg-red-500 rounded-full" style={{ width: `${stats.no}%` }}></div>
                                                    </div>
                                                </div>
                                            </div>

                                            {proposal.status === 'active' && (
                                                <button
                                                    onClick={() => { setSelectedProposal(proposal); setIsVoteOpen(true); }}
                                                    className="w-full py-2 bg-white text-black text-xs font-bold uppercase rounded-lg hover:bg-zinc-200 transition-colors"
                                                >
                                                    Vote Now
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </motion.div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Create Modal */}
            {isCreateOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div
                        className="absolute inset-0 bg-black/80 backdrop-blur-sm animate-fade-in"
                        onClick={() => setIsCreateOpen(false)}
                    />
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="relative bg-[#101012] border border-white/10 rounded-2xl p-8 w-full max-w-lg z-50 shadow-2xl"
                    >
                        <h2 className="text-2xl font-bold text-white mb-6">Create Proposal</h2>
                        <form onSubmit={handleCreateWrapper} className="space-y-6">
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-white/60 uppercase">Title</label>
                                <input
                                    type="text"
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-blue-500 focus:outline-none transition-colors"
                                    placeholder="e.g. Increase Validator Reward"
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-white/60 uppercase">Description</label>
                                <textarea
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-blue-500 focus:outline-none transition-colors min-h-[150px]"
                                    placeholder="Describe the proposal in detail..."
                                    required
                                />
                            </div>
                            <div className="flex justify-end gap-3 pt-4">
                                <button type="button" onClick={() => setIsCreateOpen(false)} className="px-4 py-2 text-white/60 hover:text-white text-sm font-bold">Cancel</button>
                                <button type="submit" className="px-6 py-2 bg-white text-black rounded-xl font-bold hover:bg-zinc-200">Submit Proposal</button>
                            </div>
                        </form>
                    </motion.div>
                </div>
            )}

            {/* Vote Modal */}
            {isVoteOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div
                        className="absolute inset-0 bg-black/80 backdrop-blur-sm animate-fade-in"
                        onClick={() => setIsVoteOpen(false)}
                    />
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="relative bg-[#101012] border border-white/10 rounded-2xl p-8 w-full max-w-md z-50 shadow-2xl"
                    >
                        <h2 className="text-xl font-bold text-white mb-2">Cast Your Vote</h2>
                        <p className="text-white/40 mb-6 text-sm">
                            Voting power is determined by your wallet balance + Reputation.
                        </p>

                        <div className="grid grid-cols-2 gap-4">
                            <button
                                onClick={() => handleVoteWrapper('yes')}
                                className="p-4 rounded-xl border border-green-500/20 bg-green-500/5 hover:bg-green-500/20 transition-all group flex flex-col items-center gap-2"
                            >
                                <CheckCircle2 size={32} className="text-green-500 group-hover:scale-110 transition-transform" />
                                <span className="text-green-400 font-bold uppercase tracking-wider">Yes</span>
                            </button>
                            <button
                                onClick={() => handleVoteWrapper('no')}
                                className="p-4 rounded-xl border border-red-500/20 bg-red-500/5 hover:bg-red-500/20 transition-all group flex flex-col items-center gap-2"
                            >
                                <XCircle size={32} className="text-red-500 group-hover:scale-110 transition-transform" />
                                <span className="text-red-400 font-bold uppercase tracking-wider">No</span>
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
        </div>
    );
}
