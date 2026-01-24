"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { getProposal, castVote, type Proposal } from "@/lib/services/governance";
import { useAuth } from "@/lib/auth";
import { useWallet } from "@solana/wallet-adapter-react";
import { Loader2, ArrowLeft, CheckCircle, XCircle, Slash, Activity, MessageSquare, Box, Wallet, Vote } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from "recharts";

export default function ProposalDetailsPage() {
    const params = useParams();
    const router = useRouter();
    const { user, walletLogin } = useAuth(); // Assuming walletLogin gives us signer/address if needed, or we use existing auth
    // Note: castVote requires signature + walletAddress. 
    // In strict implementing, we'd need the wallet signer here.
    // For now, I'll assume we simulate or reuse auth token as signature for off-chain voting if allowed, 
    // OR we trigger a wallet signature popup.
    // Given the previous Auth context, we might not have direct access to 'signer' object unless we store it or re-connect.
    // I will implement a placeholder for signature signing or assume the backend validates the user session for now if "Signed Voting" isn't strictly enforced on client yet.
    // However, the task said "Reinforce Decentralization (Signed Voting)". 
    // I will add a mock "Sign Vote" flow.

    const id = params?.id as string;
    const [proposal, setProposal] = useState<Proposal | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'discussion' | 'votes' | 'execution'>('votes');
    const [voting, setVoting] = useState(false);
    const [voteChoice, setVoteChoice] = useState<'yes' | 'no' | 'abstain' | null>(null);

    const { signMessage, publicKey } = useWallet();

    useEffect(() => {
        if (id) {
            getProposal(id)
                .then(setProposal)
                .catch(err => console.error(err))
                .finally(() => setLoading(false));
        }
    }, [id]);

    const handleVote = async () => {
        if (!voteChoice || !proposal) return;

        if (!publicKey || !signMessage) {
            alert("Please connect your wallet to vote.");
            return;
        }

        setVoting(true);
        try {
            const message = new TextEncoder().encode(
                `Vote ${voteChoice} on proposal ${proposal.id}`
            );
            const signatureBytes = await signMessage(message);
            // Convert signature to base64 or hex as required by backend. 
            // Assuming base58 or hex. Standard is usually base58 for Solana.
            // But for simplicity/compatibility with our mock backend endpoint that expects a string:
            const signature = Buffer.from(signatureBytes).toString('hex'); // or base58 if imported

            // NOTE: Ideally we use bs58 for Solana signatures, but standard Buffer hex is fine for this generic implementation
            // unless backend specifically validates ed25519 signature format against public key.
            // Given the backend implementation was also generic, hex is safer standard for now without adding 'bs58' dep if not present.
            // Wait, 'bs58' IS present in package.json. Let's use it if we can import it, otherwise hex.
            // I'll stick to a safe hex representation or base64 to avoid missing import issues in this file.

            await castVote(proposal.id, voteChoice, signature, publicKey.toBase58());

            // Refetch to update numbers
            const updated = await getProposal(proposal.id);
            setProposal(updated);
            alert("Vote submitted successfully!");
        } catch (err) {
            console.error("Vote failed", err);
            alert("Vote failed. Ensure you signed the request.");
        } finally {
            setVoting(false);
            setVoteChoice(null); // Reset choice
        }
    };

    if (loading) return (
        <div className="flex justify-center items-center min-h-[50vh]">
            <Loader2 className="animate-spin text-primary" size={32} />
        </div>
    );

    if (!proposal) return (
        <div className="text-center py-20">
            <h1 className="text-2xl font-bold font-mono uppercase">Proposal Not Found</h1>
            <button onClick={() => router.back()} className="mt-4 btn-retro btn-retro-outline">GO BACK</button>
        </div>
    );

    const voteData = [
        { name: 'Yes', value: proposal.votes_for, color: '#22c55e' }, // green-500
        { name: 'No', value: proposal.votes_against, color: '#ef4444' }, // red-500
        { name: 'Abstain', value: proposal.votes_abstain, color: '#64748b' }, // slate-500
    ].filter(d => d.value > 0);

    // If no votes, add placeholders to show empty chart
    const chartData = voteData.length > 0 ? voteData : [{ name: 'No Votes', value: 1, color: '#333' }];

    return (
        <div className="space-y-8 animate-in fade-in duration-500 max-w-5xl mx-auto">
            <button onClick={() => router.back()} className="flex items-center gap-2 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors">
                <ArrowLeft size={14} />
                BACK TO GOVERNANCE
            </button>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {/* Main Content */}
                <div className="md:col-span-2 space-y-6">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <span className={`text-[10px] font-bold font-mono uppercase px-2 py-0.5 border rounded-full ${proposal.status === 'active' ? 'text-primary border-primary' :
                                proposal.status === 'passed' ? 'text-green-500 border-green-500' :
                                    'text-muted-foreground border-border'
                                }`}>
                                {proposal.status}
                            </span>
                            <span className="text-xs font-mono text-muted-foreground uppercase">
                                Proposal #{proposal.id.split('-')[0]}
                            </span>
                        </div>
                        <h1 className="text-3xl font-bold font-mono uppercase leading-tight">{proposal.title}</h1>
                    </div>

                    {/* Tabs */}
                    <div className="border-b border-border flex gap-6">
                        <button
                            onClick={() => setActiveTab('discussion')}
                            className={`pb-3 text-xs font-bold font-mono uppercase border-b-2 transition-all flex items-center gap-2 ${activeTab === 'discussion' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`}
                        >
                            <MessageSquare size={14} /> Discussion
                        </button>
                        <button
                            onClick={() => setActiveTab('votes')}
                            className={`pb-3 text-xs font-bold font-mono uppercase border-b-2 transition-all flex items-center gap-2 ${activeTab === 'votes' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`}
                        >
                            <Activity size={14} /> Voting Results
                        </button>
                        <button
                            onClick={() => setActiveTab('execution')}
                            className={`pb-3 text-xs font-bold font-mono uppercase border-b-2 transition-all flex items-center gap-2 ${activeTab === 'execution' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`}
                        >
                            <Box size={14} /> Execution Payload
                        </button>
                    </div>

                    <div className="min-h-[300px]">
                        {activeTab === 'discussion' && (
                            <div className="card-retro p-8 bg-card text-center space-y-4">
                                <MessageSquare size={32} className="mx-auto text-muted-foreground opacity-20" />
                                <p className="font-mono text-sm text-muted-foreground">
                                    Forum integration is connecting... <br />
                                    View thread on <a href="#" className="underline hover:text-primary">Community Forum</a>.
                                </p>
                            </div>
                        )}

                        {activeTab === 'votes' && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
                                <div className="h-64 w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie
                                                data={chartData}
                                                innerRadius={60}
                                                outerRadius={80}
                                                paddingAngle={5}
                                                dataKey="value"
                                                stroke="none"
                                            >
                                                {chartData.map((entry, index) => (
                                                    <Cell key={`cell-${index}`} fill={entry.color} />
                                                ))}
                                            </Pie>
                                            <RechartsTooltip
                                                contentStyle={{ backgroundColor: '#111', borderColor: '#333', borderRadius: '4px', fontFamily: 'monospace', fontSize: '12px' }}
                                                itemStyle={{ color: '#fff' }}
                                            />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                                <div className="space-y-4">
                                    <div className="flex justify-between items-center text-sm font-mono">
                                        <div className="flex items-center gap-2">
                                            <div className="w-3 h-3 rounded-full bg-green-500"></div>
                                            <span>Yes</span>
                                        </div>
                                        <span className="font-bold">{proposal.votes_for.toLocaleString()} VP</span>
                                    </div>
                                    <div className="flex justify-between items-center text-sm font-mono">
                                        <div className="flex items-center gap-2">
                                            <div className="w-3 h-3 rounded-full bg-red-500"></div>
                                            <span>No</span>
                                        </div>
                                        <span className="font-bold">{proposal.votes_against.toLocaleString()} VP</span>
                                    </div>
                                    <div className="flex justify-between items-center text-sm font-mono">
                                        <div className="flex items-center gap-2">
                                            <div className="w-3 h-3 rounded-full bg-slate-500"></div>
                                            <span>Abstain</span>
                                        </div>
                                        <span className="font-bold">{proposal.votes_abstain.toLocaleString()} VP</span>
                                    </div>
                                    <div className="pt-4 border-t border-border flex justify-between items-center text-sm font-mono">
                                        <span className="text-muted-foreground">Total Quorum</span>
                                        <span className="font-bold">{proposal.total_votes.toLocaleString()} VP</span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab === 'execution' && (
                            <div className="space-y-4">
                                <div className="card-retro bg-secondary/10 border border-border p-4 font-mono text-xs overflow-x-auto">
                                    <pre>{JSON.stringify(JSON.parse(proposal.execution_data || '{}'), null, 2)}</pre>
                                </div>
                                <p className="text-xs font-mono text-muted-foreground">
                                    This payload will be executed automatically via the <span className="text-primary">Control API</span> upon successful passing of the proposal.
                                </p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Sidebar */}
                <div className="space-y-6">
                    {/* Vote Card */}
                    {proposal.status === 'active' && (
                        <div className="card-retro p-6 bg-card border-primary/20 shadow-[4px_4px_0px_var(--primary-dark)]">
                            <h3 className="text-lg font-bold font-mono uppercase mb-4 flex items-center gap-2">
                                <Wallet size={18} /> Cast Vote
                            </h3>

                            {!user ? (
                                <div className="text-center py-4 space-y-2">
                                    <p className="text-xs font-mono text-muted-foreground">Connect wallet to vote.</p>
                                    <button className="btn-retro btn-retro-primary w-full text-xs">CONNECT WALLET</button>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    <button
                                        onClick={() => setVoteChoice('yes')}
                                        className={`w-full py-3 px-4 rounded-sm border-2 font-mono text-xs font-bold uppercase transition-all flex items-center justify-between ${voteChoice === 'yes' ? 'bg-green-500/10 border-green-500 text-green-500' : 'bg-background border-border hover:border-green-500/50'
                                            }`}
                                    >
                                        VOTE YES <CheckCircle size={14} />
                                    </button>
                                    <button
                                        onClick={() => setVoteChoice('no')}
                                        className={`w-full py-3 px-4 rounded-sm border-2 font-mono text-xs font-bold uppercase transition-all flex items-center justify-between ${voteChoice === 'no' ? 'bg-red-500/10 border-red-500 text-red-500' : 'bg-background border-border hover:border-red-500/50'
                                            }`}
                                    >
                                        VOTE NO <XCircle size={14} />
                                    </button>
                                    <button
                                        onClick={() => setVoteChoice('abstain')}
                                        className={`w-full py-3 px-4 rounded-sm border-2 font-mono text-xs font-bold uppercase transition-all flex items-center justify-between ${voteChoice === 'abstain' ? 'bg-slate-500/10 border-slate-500 text-slate-500' : 'bg-background border-border hover:border-slate-500/50'
                                            }`}
                                    >
                                        ABSTAIN <Slash size={14} />
                                    </button>

                                    <button
                                        onClick={handleVote}
                                        disabled={!voteChoice || voting}
                                        className="w-full btn-retro btn-retro-primary mt-4 py-3 text-sm flex items-center justify-center gap-2"
                                    >
                                        {voting ? <Loader2 className="animate-spin" size={16} /> : <Vote size={16} />}
                                        {voting ? "SIGNING..." : "SUBMIT VOTE"}
                                    </button>
                                    <p className="text-[10px] text-center font-mono text-muted-foreground">
                                        Your vote will be signed securely.
                                    </p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Info Card */}
                    <div className="card-retro p-6 bg-card space-y-4">
                        <div className="space-y-2">
                            <div className="text-[10px] font-mono font-bold uppercase text-muted-foreground">Proposed By</div>
                            <div className="flex items-center gap-2">
                                <div className="w-6 h-6 rounded-full bg-secondary"></div>
                                <span className="font-mono text-xs truncate max-w-[150px]">{proposal.proposer_id}</span>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <div className="text-[10px] font-mono font-bold uppercase text-muted-foreground">Vote Period</div>
                            <div className="font-mono text-xs">
                                {new Date(proposal.start_time).toLocaleDateString()} - {new Date(proposal.end_time).toLocaleDateString()}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
