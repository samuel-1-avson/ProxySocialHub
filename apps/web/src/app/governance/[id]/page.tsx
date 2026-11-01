"use client";

import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PageHeading,
  Loading,
  DataError,
} from "@/components/workspace/Patterns";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  getProposal,
  castGovernanceVote,
  finalizeProposal,
  type Proposal,
} from "@/lib/services/governance";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAuth } from "@/lib/auth";
import {
  Loader2,
  ArrowLeft,
  CheckCircle,
  XCircle,
  MessageSquare,
  Box,
  ShieldCheck,
  Clock,
  Zap,
  Target,
  BarChart3,
  Fingerprint,
  Terminal,
  FileText,
} from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts";
import { motion, AnimatePresence } from "framer-motion";
import { GlassCard } from "@/components/ui/glass-card";
import { ProposalImpactPreview } from "@/components/governance/ProposalImpactPreview";
import { ProposalTreasuryAudit } from "@/components/governance/ProposalTreasuryAudit";
import { UnlockWalletPrompt } from "@/components/UnlockWalletPrompt";

export default function ProposalDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const [activeTab, setActiveTab] = useState<
    "discussion" | "votes" | "execution"
  >("votes");
  const [voting, setVoting] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [voteChoice, setVoteChoice] = useState<"yes" | "no" | null>(null);
  const [voteError, setVoteError] = useState("");
  const [finalizeError, setFinalizeError] = useState("");

  const { signMessage, signTransaction, publicKey, connected, wallet } =
    useWallet();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = ["governance", "proposal", id, user?.id];
  const query = useQuery({
    queryKey,
    queryFn: () => getProposal(id),
    enabled: !!id,
  });
  const proposal = query.data ?? null;
  const loading = query.isPending;
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  function setProposal(
    update: Proposal | ((previous: Proposal | null) => Proposal | null),
  ) {
    queryClient.setQueryData<Proposal>(
      queryKey,
      (previous) =>
        (typeof update === "function" ? update(previous ?? null) : update) ??
        undefined,
    );
  }

  const linkedWallet = user?.wallet_address?.trim() || "";
  const adapterWallet = publicKey?.toBase58() || "";
  const walletMatchesLinked =
    !!linkedWallet && !!adapterWallet && linkedWallet === adapterWallet;
  const walletName = wallet?.adapter?.name?.trim() || "";
  const walletLooksLikeMetaMask = /metamask/i.test(walletName);
  const solanaNetwork =
    (process.env.NEXT_PUBLIC_SOLANA_NETWORK || "devnet").trim() || "devnet";
  const canSignVote = walletMatchesLinked && !walletLooksLikeMetaMask;

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const votingClosed = proposal?.end_time ? new Date(proposal.end_time).getTime() <= currentTime : false;

  const handleVote = async () => {
    if (!voteChoice || !proposal) return;

    if (!publicKey || !signMessage || !signTransaction) {
      setVoteError(
        "Connect your linked Solana wallet (with transaction signing) to vote on-chain.",
      );
      return;
    }
    if (!linkedWallet) {
      setVoteError("Link a Solana wallet on your account before voting.");
      return;
    }
    if (!walletMatchesLinked) {
      setVoteError(
        `Connected wallet does not match your linked account wallet (${linkedWallet.slice(0, 4)}…${linkedWallet.slice(-4)}). Disconnect and connect the correct wallet.`,
      );
      return;
    }
    if (walletLooksLikeMetaMask) {
      setVoteError(
        `MetaMask is on Solana Mainnet; ProxyHubb Testnet uses ${solanaNetwork}. Cancel in MetaMask, disconnect it, then connect Phantom (or Solflare) on ${solanaNetwork}.`,
      );
      return;
    }

    setVoting(true);
    setVoteError("");
    try {
      const cast = await castGovernanceVote(
        proposal.id,
        voteChoice,
        adapterWallet,
        signMessage,
        signTransaction,
      );

      const myVote = cast.my_vote ?? {
        choice: cast.choice,
        power: cast.power ?? cast.voting_power ?? 1,
      };

      // Apply on-chain tallies immediately so the chart updates before refetch.
      setProposal((prev) => {
        if (!prev) return prev;
        const yes = cast.yes_votes != null ? cast.yes_votes : prev.yes_votes;
        const no = cast.no_votes != null ? cast.no_votes : prev.no_votes;
        return {
          ...prev,
          yes_votes: yes,
          no_votes: no,
          votes_for: yes,
          votes_against: no,
          total_votes: yes + no + (prev.votes_abstain || 0),
          my_vote: myVote,
        };
      });

      // Refetch with auth so my_vote + chain overlay stay consistent.
      try {
        const updated = await getProposal(proposal.id);
        const yes = cast.yes_votes ?? updated.yes_votes;
        const no = cast.no_votes ?? updated.no_votes;
        setProposal({
          ...updated,
          my_vote: updated.my_vote ?? myVote,
          yes_votes: yes,
          no_votes: no,
          votes_for: yes,
          votes_against: no,
          total_votes: yes + no + (updated.votes_abstain || 0),
        });
      } catch {
        // Keep optimistic state if refetch fails.
      }
    } catch (err) {
      console.error("Vote failed", err);
      const raw = err instanceof Error ? err.message : "Vote failed";
      if (/already.?vot/i.test(raw)) {
        try {
          const updated = await getProposal(proposal.id);
          setProposal(updated);
          setVoteError("");
        } catch {
          setVoteError("You have already voted on this proposal.");
        }
      } else if (
        /simulat|revert|mainnet|User rejected|rejected the request|WalletSignTransactionError/i.test(
          raw,
        )
      ) {
        setVoteError(
          `Wallet could not sign the ${solanaNetwork} vote tx (often MetaMask Mainnet or wrong cluster). Cancel the wallet popup, use Phantom on ${solanaNetwork}, then retry. Details: ${raw}`,
        );
      } else {
        setVoteError(raw);
      }
    } finally {
      setVoting(false);
      setVoteChoice(null);
    }
  };

  const handleFinalize = async () => {
    if (!proposal) return;
    setFinalizing(true);
    setFinalizeError("");
    try {
      await finalizeProposal(proposal.id);
      const updated = await getProposal(proposal.id);
      setProposal(updated);
    } catch (err) {
      setFinalizeError(err instanceof Error ? err.message : "Finalize failed");
    } finally {
      setFinalizing(false);
    }
  };

  const executionPayload = (() => {
    if (!proposal?.execution_data?.trim()) return {};
    try {
      return JSON.parse(proposal.execution_data) as Record<string, unknown>;
    } catch {
      return { raw: proposal.execution_data };
    }
  })();

  const containerVariants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.1 },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0 },
  };

  if (loading) return <Loading label="Loading proposal…" />;
  if (query.isError || !proposal)
    return (
      <div className="ui-page">
        <Link href="/governance" className="ui-link">
          ← Back to proposals
        </Link>
        <PageHeading
          title="Proposal unavailable"
          description="This proposal could not be loaded. Try again or return to the proposal list."
        />
        <DataError error={query.error} retry={() => void query.refetch()} />
      </div>
    );

  const voteData = [
    { name: "SUPPORT", value: proposal.votes_for, color: "#10B981" },
    { name: "REJECT", value: proposal.votes_against, color: "#F43F5E" },
  ].filter((d) => d.value > 0);

  const chartData =
    voteData.length > 0
      ? voteData
      : [
          {
            name: "EMPTY_CONSENSUS",
            value: 1,
            color: "rgba(255,255,255,0.05)",
          },
        ];

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="governance-detail space-y-8 max-w-6xl mx-auto pb-16"
    >
      <motion.button
        variants={itemVariants}
        onClick={() => router.back()}
        className="group flex items-center gap-3 text-sm font-black tracking-wide text-muted-foreground hover:text-primary transition-all uppercase"
      >
        <div className="p-2 rounded-lg bg-secondary border border-border group-hover:border-primary/40 group-hover:bg-primary/5 transition-all">
          <ArrowLeft size={14} />
        </div>
        Back to proposals
      </motion.button>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
        {/* Main Content Area */}
        <div className="lg:col-span-8 space-y-10">
          <motion.div variants={itemVariants} className="space-y-4">
            <div className="flex items-center gap-4 flex-wrap">
              <div
                className={`flex items-center gap-2 px-3 py-1 rounded-lg border text-xs font-semibold tracking-wide ${
                  proposal.status === "active"
                    ? "bg-primary/10 text-primary border-primary/20 shadow-lg shadow-primary/10"
                    : proposal.status === "passed"
                      ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20 shadow-lg shadow-emerald-500/10"
                      : "bg-secondary text-muted-foreground border-border"
                }`}
              >
                <Target
                  size={10}
                  className={
                    proposal.status === "active" ? "animate-pulse" : ""
                  }
                />
                Status: {proposal.status}
              </div>
              <span className="text-sm font-mono text-muted-foreground uppercase font-black tracking-wide">
                Proposal reference · {proposal.id.split("-")[0]}
              </span>
            </div>
            <h1 className="text-4xl lg:text-5xl font-semibold tracking-tighter leading-tight text-foreground hover:text-primary transition-colors duration-500">
              {proposal.title}
            </h1>
          </motion.div>

          {/* Mode Interface Selector */}
          <motion.div
            variants={itemVariants}
            className="governance-detail-tabs"
          >
            {[
              { id: "votes", label: "Votes", icon: BarChart3 },
              { id: "discussion", label: "Discussion", icon: MessageSquare },
              { id: "execution", label: "Execution", icon: Box },
            ].map((tab) => (
              <button
                key={tab.id}
                aria-pressed={activeTab === tab.id}
                onClick={() =>
                  setActiveTab(tab.id as "discussion" | "votes" | "execution")
                }
                className={`flex items-center gap-3 px-6 py-2.5 rounded-xl text-sm font-semibold tracking-wide transition-all ${
                  activeTab === tab.id
                    ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                }`}
              >
                <tab.icon size={14} />
                {tab.label}
              </button>
            ))}
          </motion.div>

          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="min-h-[400px]"
            >
              {activeTab === "votes" && (
                <GlassCard className="!p-10 grid grid-cols-1 md:grid-cols-2 gap-12 items-center relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent pointer-events-none" />
                  <div className="h-64 lg:h-80 w-full relative">
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="text-center space-y-1">
                        <div className="text-sm font-black text-muted-foreground uppercase tracking-wide">
                          Quorum
                        </div>
                        <div className="text-3xl font-black tracking-tighter">
                          {proposal.total_votes}
                        </div>
                        <div className="text-[8px] font-black text-primary/40 uppercase tracking-wide">
                          VP Total
                        </div>
                      </div>
                    </div>
                    <ResponsiveContainer
                      width="100%"
                      height="100%"
                      minWidth={0}
                      minHeight={0}
                    >
                      <PieChart>
                        <Pie
                          data={chartData}
                          innerRadius={80}
                          outerRadius={110}
                          paddingAngle={8}
                          dataKey="value"
                          stroke="none"
                          animationBegin={0}
                          animationDuration={1500}
                        >
                          {chartData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <RechartsTooltip
                          contentStyle={{
                            backgroundColor: "#09090b",
                            borderColor: "rgba(255,255,255,0.05)",
                            borderRadius: "12px",
                            fontFamily: "var(--font-mono)",
                            fontSize: "10px",
                            textTransform: "uppercase",
                            fontWeight: 900,
                          }}
                          itemStyle={{ color: "#fff" }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-6 relative z-10">
                    <div className="space-y-4">
                      {[
                        {
                          label: "Support",
                          votes: proposal.votes_for,
                          color: "bg-emerald-500",
                        },
                        {
                          label: "Oppose",
                          votes: proposal.votes_against,
                          color: "bg-rose-500",
                        },
                      ].map((item, i) => (
                        <div key={i} className="group/stat">
                          <div className="flex justify-between items-center text-sm font-semibold tracking-wide mb-2">
                            <div className="flex items-center gap-3">
                              <div
                                className={`w-2 h-2 rounded-full ${item.color} shadow-[0_0_10px_currentColor]`}
                              />
                              <span className="text-muted-foreground group-hover/stat:text-foreground transition-colors">
                                {item.label}
                              </span>
                            </div>
                            <span className="font-black text-foreground">
                              {item.votes.toLocaleString()} VP
                            </span>
                          </div>
                          <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{
                                width: `${(item.votes / (proposal.total_votes || 1)) * 100}%`,
                              }}
                              transition={{ duration: 1, delay: 0.5 }}
                              className={`h-full ${item.color}`}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="pt-8 border-t border-border flex justify-between items-center text-sm font-semibold tracking-wide text-muted-foreground">
                      <span>Quorum target (VP)</span>
                      <span className="text-primary/60">
                        {proposal.quorum.toLocaleString()} VP
                      </span>
                    </div>
                  </div>
                </GlassCard>
              )}

              {activeTab === "discussion" && (
                <GlassCard className="!p-16 text-center space-y-8 border-border">
                  <div className="w-20 h-20 rounded-full bg-secondary border border-border flex items-center justify-center mx-auto">
                    <MessageSquare size={32} className="text-primary/40" />
                  </div>
                  <div className="space-y-3">
                    <h3 className="text-xl font-semibold tracking-tighter">
                      Community discussion
                    </h3>
                    <p className="text-sm font-black text-muted-foreground uppercase tracking-wide leading-relaxed max-w-xs mx-auto">
                      {proposal.thread_id
                        ? "A forum thread was created when this proposal was submitted."
                        : "No forum thread is linked to this proposal yet."}
                    </p>
                  </div>
                  {proposal.thread_id ? (
                    <Link
                      href={`/community/forum/thread/${proposal.thread_id}`}
                      className="inline-block px-8 py-3 glass-card border-border text-xs font-semibold tracking-wide hover:border-primary/40 transition-all rounded-xl"
                    >
                      Open forum thread
                    </Link>
                  ) : null}
                </GlassCard>
              )}

              {activeTab === "execution" && (
                <div className="space-y-6">
                  <GlassCard className="!p-8 bg-card relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none group-hover:scale-110 transition-transform">
                      <Terminal size={120} className="text-primary" />
                    </div>
                    <div className="text-sm font-semibold tracking-wide text-muted-foreground mb-6 border-b border-border pb-4">
                      Execution payload
                    </div>
                    <pre className="text-sm font-mono p-6 bg-secondary border border-border rounded-2xl overflow-x-auto text-primary/80 leading-relaxed max-h-[400px]">
                      <code>{JSON.stringify(executionPayload, null, 2)}</code>
                    </pre>
                  </GlassCard>
                  <div className="flex items-start gap-4 p-6 bg-primary/5 border border-primary/10 rounded-2xl">
                    <Zap size={20} className="text-primary shrink-0" />
                    <p className="text-sm font-semibold tracking-wide leading-relaxed text-muted-foreground">
                      Closing a vote finalizes on-chain status
                      (passed/rejected). Treasury payloads are queued for
                      custody review — they are not auto-spent from the
                      operational hot wallet.
                    </p>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          {/* Description Area */}
          <motion.div
            variants={itemVariants}
            className="space-y-8 border-t border-border pt-10"
          >
            <div className="flex items-center gap-3 text-sm font-semibold tracking-wide text-muted-foreground">
              <FileText size={14} className="text-primary" /> Proposal rationale
            </div>
            <p className="text-sm lg:text-lg leading-relaxed text-foreground/70 font-semibold tracking-tight selection:bg-primary selection:text-primary-foreground italic">
              {proposal.description}
            </p>
          </motion.div>
        </div>

        {/* Sidebar - Control Module */}
        <div className="lg:col-span-4 space-y-8">
          <motion.div variants={itemVariants}>
            <ProposalImpactPreview mode="proposal" proposalId={proposal.id} />
          </motion.div>
          <motion.div variants={itemVariants}>
            <ProposalTreasuryAudit
              proposalId={proposal.id}
              showWhenEmpty={proposal.type === "treasury"}
            />
          </motion.div>
          {proposal.status === "active" && (
            <motion.div variants={itemVariants}>
              <GlassCard className="!p-8 border-primary/30 bg-primary/[0.03] shadow-[0_0_50px_rgba(16,185,129,0.1)] group">
                <h3 className="text-sm font-semibold tracking-wide mb-8 border-b border-border pb-4 text-muted-foreground flex justify-between items-center group-hover:text-primary transition-colors">
                  Cast your vote
                  <Fingerprint size={16} className="animate-pulse" />
                </h3>

                {proposal.my_vote ? (
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold tracking-wide text-emerald-400/80 mb-1">
                          Ballot recorded
                        </p>
                        <p className="text-sm font-semibold text-emerald-300">
                          {proposal.my_vote.choice === "no"
                            ? "Reject Unit"
                            : "Support Unit"}
                        </p>
                      </div>
                      <CheckCircle size={22} className="text-emerald-400" />
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      One vote per linked wallet. You cannot change or cast
                      again on this proposal.
                    </p>
                  </div>
                ) : (
                  <>
                    {linkedWallet && !walletMatchesLinked && (
                      <div className="mb-6">
                        <UnlockWalletPrompt
                          expectedAddress={linkedWallet}
                          mismatch={connected}
                        />
                      </div>
                    )}
                    {walletLooksLikeMetaMask && (
                      <div className="mb-6 rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 space-y-2">
                        <p className="text-sm font-semibold text-rose-300">
                          MetaMask cannot vote on Testnet
                        </p>
                        <p className="text-sm text-rose-200/90 leading-relaxed">
                          That popup is signing on Solana Mainnet. ProxyHubb
                          Testnet is {solanaNetwork}. Cancel MetaMask,
                          disconnect it here, then connect Phantom or Solflare
                          with the network set to {solanaNetwork}.
                        </p>
                      </div>
                    )}

                    <div className="space-y-4">
                      {[
                        {
                          id: "yes",
                          label: "Support",
                          icon: CheckCircle,
                          color:
                            "hover:border-emerald-500/50 hover:bg-emerald-500/5",
                          active:
                            "border-emerald-500 bg-emerald-500/10 text-emerald-500 shadow-lg shadow-emerald-500/10",
                        },
                        {
                          id: "no",
                          label: "Oppose",
                          icon: XCircle,
                          color: "hover:border-rose-500/50 hover:bg-rose-500/5",
                          active:
                            "border-rose-500 bg-rose-500/10 text-rose-500 shadow-lg shadow-rose-500/10",
                        },
                      ].map((option) => (
                        <button
                          key={option.id}
                          aria-pressed={voteChoice === option.id}
                          onClick={() =>
                            setVoteChoice(option.id as "yes" | "no")
                          }
                          className={`w-full p-5 rounded-2xl border border-border flex items-center justify-between text-sm font-semibold tracking-wide transition-all ${
                            voteChoice === option.id
                              ? option.active
                              : `bg-background ${option.color} text-muted-foreground`
                          }`}
                        >
                          {option.label}
                          <option.icon size={18} />
                        </button>
                      ))}

                      <button
                        onClick={handleVote}
                        disabled={!voteChoice || voting || !canSignVote}
                        className="w-full mt-6 py-5 bg-primary text-primary-foreground rounded-2xl font-black text-xs uppercase tracking-wide flex items-center justify-center gap-3 hover:shadow-[0_0_40px_rgba(16,185,129,0.3)] transition-all active:scale-[0.98] disabled:opacity-20"
                      >
                        {voting ? (
                          <Loader2 className="animate-spin" size={20} />
                        ) : (
                          <Zap size={20} />
                        )}
                        {voting ? "INITIALIZING SIGNATURE..." : "Submit vote"}
                      </button>
                      {voteError && (
                        <p className="text-xs text-center font-semibold tracking-wide text-rose-400 leading-relaxed mt-4">
                          {voteError}
                        </p>
                      )}
                      <p className="text-xs text-center font-semibold tracking-wide text-muted-foreground leading-relaxed mt-4">
                        Signs vote:{proposal.id}:yes|no, builds an on-chain tx,
                        and mirrors after relay. Weight is fixed at 1 per
                        wallet. Abstain is not supported on-chain.
                      </p>
                    </div>
                  </>
                )}
              </GlassCard>
            </motion.div>
          )}

          {proposal.status === "active" && votingClosed && (
            <motion.div variants={itemVariants}>
              <GlassCard className="!p-8 border-amber-500/20 bg-amber-500/[0.03]">
                <h3 className="text-sm font-semibold tracking-wide mb-4 text-muted-foreground">
                  Close voting
                </h3>
                <p className="text-xs font-semibold tracking-wide text-muted-foreground mb-6 leading-relaxed">
                  Voting window ended. Finalize on-chain to set passed/rejected.
                  Treasury payloads still require custody — no hot-wallet
                  auto-spend.
                </p>
                <button
                  type="button"
                  onClick={handleFinalize}
                  disabled={finalizing}
                  className="w-full py-4 bg-amber-500/20 border border-amber-500/40 text-amber-200 rounded-2xl font-black text-xs uppercase tracking-wide flex items-center justify-center gap-3 hover:bg-amber-500/30 transition-all disabled:opacity-40"
                >
                  {finalizing ? (
                    <Loader2 className="animate-spin" size={18} />
                  ) : (
                    <Clock size={18} />
                  )}
                  {finalizing ? "Finalizing…" : "Finalize on-chain"}
                </button>
                {finalizeError && (
                  <p className="text-xs text-center font-semibold tracking-wide text-rose-400 leading-relaxed mt-4">
                    {finalizeError}
                  </p>
                )}
              </GlassCard>
            </motion.div>
          )}

          <motion.div variants={itemVariants}>
            <GlassCard className="!p-8 space-y-8 bg-secondary border border-border relative overflow-hidden group">
              <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent pointer-events-none" />

              <div className="space-y-2 relative z-10">
                <div className="text-xs font-semibold text-muted-foreground tracking-wide">
                  Proposer
                </div>
                <div className="flex items-center gap-4 p-4 rounded-2xl bg-background border border-border group-hover:border-primary/20 transition-all">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                    <ShieldCheck size={20} />
                  </div>
                  <span className="font-black text-sm tracking-tighter truncate text-foreground opacity-60 group-hover:opacity-100 transition-opacity">
                    {proposal.proposer_id}
                  </span>
                </div>
              </div>

              <div className="space-y-4 relative z-10">
                <div className="text-xs font-semibold text-muted-foreground tracking-wide">
                  Settlement Timeline
                </div>
                <div className="p-5 space-y-4 rounded-2xl bg-secondary border border-border">
                  <div className="flex justify-between items-center text-sm uppercase font-black tracking-wide">
                    <span className="text-muted-foreground flex items-center gap-2">
                      <Clock size={12} /> Initialized
                    </span>
                    <span className="text-foreground/60">
                      {new Date(proposal.start_time).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-sm uppercase font-black tracking-wide">
                    <span className="text-primary/40 flex items-center gap-2">
                      <Target size={12} /> Deadline
                    </span>
                    <span className="text-primary">
                      {new Date(proposal.end_time).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </div>

              <div className="space-y-4 relative z-10">
                <div className="text-xs font-semibold text-muted-foreground tracking-wide">
                  Proposal Meta
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="px-3 py-1 bg-secondary border border-border rounded-lg text-[8px] font-semibold tracking-wide text-muted-foreground">
                    {proposal.type}
                  </span>
                  <span className="px-3 py-1 bg-secondary border border-border rounded-lg text-[8px] font-semibold tracking-wide text-muted-foreground">
                    Proposal record
                  </span>
                </div>
              </div>
            </GlassCard>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}
