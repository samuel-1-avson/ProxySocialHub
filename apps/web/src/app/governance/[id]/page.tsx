"use client";

import { useState, useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { getProposal, castGovernanceVote, finalizeProposal, type Proposal } from "@/lib/services/governance";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAuth } from "@/lib/auth";
import { Loader2 } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from "recharts";
import { ProposalImpactPreview } from "@/components/governance/ProposalImpactPreview";
import { ProposalTreasuryAudit } from "@/components/governance/ProposalTreasuryAudit";
import { UnlockWalletPrompt } from "@/components/UnlockWalletPrompt";
import {
    PageHeading,
    Loading,
    DataError,
    EmptyState,
    Status,
    shortDate,
} from "@/components/workspace/Patterns";

function statusTone(status: string): "good" | "warning" | "error" | "neutral" {
    switch (status) {
        case "active":
            return "warning";
        case "passed":
        case "executed":
            return "good";
        case "rejected":
            return "error";
        default:
            return "neutral";
    }
}

export default function ProposalDetailsPage() {
    const params = useParams();
    const router = useRouter();
    const id = params?.id as string;
    const [proposal, setProposal] = useState<Proposal | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<unknown>(null);
    const [activeTab, setActiveTab] = useState<"discussion" | "votes" | "execution">("votes");
    const [voting, setVoting] = useState(false);
    const [finalizing, setFinalizing] = useState(false);
    const [voteChoice, setVoteChoice] = useState<"yes" | "no" | null>(null);
    const [voteError, setVoteError] = useState("");
    const [finalizeError, setFinalizeError] = useState("");

    const { signMessage, signTransaction, publicKey, connected, wallet } = useWallet();
    const { user } = useAuth();
    const linkedWallet = user?.wallet_address?.trim() || "";
    const adapterWallet = publicKey?.toBase58() || "";
    const walletMatchesLinked =
        !!linkedWallet && !!adapterWallet && linkedWallet === adapterWallet;
    const walletName = wallet?.adapter?.name?.trim() || "";
    const walletLooksLikeMetaMask = /metamask/i.test(walletName);
    const solanaNetwork = (process.env.NEXT_PUBLIC_SOLANA_NETWORK || "devnet").trim() || "devnet";
    const canSignVote = walletMatchesLinked && !walletLooksLikeMetaMask;

    const loadProposal = () => {
        if (!id) return;
        setLoading(true);
        setLoadError(null);
        getProposal(id)
            .then(setProposal)
            .catch((err) => {
                console.error(err);
                setLoadError(err);
            })
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        if (id) {
            getProposal(id)
                .then(setProposal)
                .catch((err) => {
                    console.error(err);
                    setLoadError(err);
                })
                .finally(() => setLoading(false));
        }
    }, [id]);

    const votingClosed = useMemo(() => {
        if (!proposal?.end_time) return false;
        return new Date(proposal.end_time).getTime() <= Date.now();
    }, [proposal?.end_time]);

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
            } else if (/simulat|revert|mainnet|User rejected|rejected the request|WalletSignTransactionError/i.test(raw)) {
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

    if (loading) return <Loading label="Loading proposal…" />;

    if (loadError) {
        return <DataError error={loadError} retry={loadProposal} />;
    }

    if (!proposal) {
        return (
            <EmptyState
                title="Proposal not found"
                description="This proposal is unavailable or the link is incorrect."
                href="/governance"
                action="Back to governance"
            />
        );
    }

    const voteData = [
        { name: "Support", value: proposal.votes_for, color: "var(--success)" },
        { name: "Reject", value: proposal.votes_against, color: "var(--error)" },
    ].filter((d) => d.value > 0);

    const chartData =
        voteData.length > 0
            ? voteData
            : [{ name: "No votes", value: 1, color: "var(--secondary)" }];

    return (
        <div className="ui-page">
            <button type="button" onClick={() => router.back()} className="ui-link text-sm text-left">
                Back
            </button>

            <PageHeading
                eyebrow={`Proposal ${proposal.id.split("-")[0]}`}
                title={proposal.title}
                description={`Type ${proposal.type}. Voting ${shortDate(proposal.start_time)} – ${shortDate(proposal.end_time)}.`}
                actions={<Status tone={statusTone(proposal.status)}>{proposal.status}</Status>}
            />

            <div className="ui-columns">
                <div className="space-y-8 min-w-0">
                    <nav className="ui-tabs" aria-label="Proposal sections">
                        {(
                            [
                                { id: "votes", label: "Votes" },
                                { id: "discussion", label: "Discussion" },
                                { id: "execution", label: "Execution" },
                            ] as const
                        ).map((tab) => (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => setActiveTab(tab.id)}
                                className={activeTab === tab.id ? "active" : ""}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </nav>

                    {activeTab === "votes" && (
                        <section className="ui-surface">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center min-w-0">
                                <div className="h-64 w-full min-w-0 relative">
                                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                        <div className="text-center">
                                            <div className="ui-stat-label">Total votes</div>
                                            <div className="ui-stat-value">{proposal.total_votes}</div>
                                        </div>
                                    </div>
                                    <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
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
                                                    backgroundColor: "var(--card)",
                                                    borderColor: "var(--border)",
                                                    borderRadius: "8px",
                                                    fontSize: "13px",
                                                    color: "var(--foreground)",
                                                }}
                                                itemStyle={{ color: "var(--foreground)" }}
                                            />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                                <div className="space-y-4">
                                    {[
                                        { label: "Support", votes: proposal.votes_for },
                                        { label: "Reject", votes: proposal.votes_against },
                                    ].map((item) => (
                                        <div key={item.label}>
                                            <div className="flex justify-between items-center text-sm mb-2">
                                                <span className="text-muted-foreground">{item.label}</span>
                                                <span>{item.votes.toLocaleString()}</span>
                                            </div>
                                            <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-primary"
                                                    style={{
                                                        width: `${(item.votes / (proposal.total_votes || 1)) * 100}%`,
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    ))}
                                    <div className="pt-4 border-t border-border flex justify-between items-center text-sm text-muted-foreground">
                                        <span>Quorum target</span>
                                        <span>{proposal.quorum.toLocaleString()}</span>
                                    </div>
                                </div>
                            </div>
                        </section>
                    )}

                    {activeTab === "discussion" && (
                        <section className="ui-surface text-center space-y-4">
                            <h2>Community discussion</h2>
                            <p className="text-sm text-muted-foreground max-w-md mx-auto">
                                {proposal.thread_id
                                    ? "A forum thread was created when this proposal was submitted."
                                    : "No forum thread is linked to this proposal yet."}
                            </p>
                            {proposal.thread_id ? (
                                <Link
                                    href={`/community/forum/thread/${proposal.thread_id}`}
                                    className="ui-button"
                                >
                                    Open forum thread
                                </Link>
                            ) : null}
                        </section>
                    )}

                    {activeTab === "execution" && (
                        <div className="space-y-4">
                            <section className="ui-surface min-w-0">
                                <h2>On-chain payload</h2>
                                <pre className="ui-code mt-4 max-h-[400px]">
                                    <code>{JSON.stringify(executionPayload, null, 2)}</code>
                                </pre>
                            </section>
                            <p className="ui-note">
                                Closing a vote finalizes on-chain status (passed/rejected). Treasury payloads
                                are queued for custody review. They are not auto-spent from the operational
                                hot wallet.
                            </p>
                        </div>
                    )}

                    <section className="ui-surface">
                        <h2>Description</h2>
                        <p className="text-sm leading-relaxed text-foreground mt-3">
                            {proposal.description}
                        </p>
                    </section>
                </div>

                <div className="space-y-6 min-w-0">
                    <ProposalImpactPreview mode="proposal" proposalId={proposal.id} />
                    <ProposalTreasuryAudit
                        proposalId={proposal.id}
                        showWhenEmpty={proposal.type === "treasury"}
                    />

                    {proposal.status === "active" && (
                        <section className="ui-surface">
                            <h2>Cast vote</h2>

                            {proposal.my_vote ? (
                                <div className="space-y-3 mt-4">
                                    <p className="text-sm">
                                        Ballot recorded:{" "}
                                        {proposal.my_vote.choice === "no" ? "Reject" : "Support"}
                                    </p>
                                    <p className="ui-note">
                                        One vote per linked wallet. You cannot change or cast again on this
                                        proposal.
                                    </p>
                                </div>
                            ) : (
                                <>
                                    {linkedWallet && !walletMatchesLinked && (
                                        <div className="my-4">
                                            <UnlockWalletPrompt
                                                expectedAddress={linkedWallet}
                                                mismatch={connected}
                                            />
                                        </div>
                                    )}
                                    {walletLooksLikeMetaMask && (
                                        <div className="ui-error my-4" role="alert">
                                            <strong>MetaMask cannot vote on Testnet</strong>
                                            <p>
                                                That popup is signing on Solana Mainnet. ProxyHubb Testnet is{" "}
                                                {solanaNetwork}. Cancel MetaMask, disconnect it here, then
                                                connect Phantom or Solflare with the network set to{" "}
                                                {solanaNetwork}.
                                            </p>
                                        </div>
                                    )}

                                    <div className="space-y-3 mt-4">
                                        {(
                                            [
                                                { id: "yes", label: "Support" },
                                                { id: "no", label: "Reject" },
                                            ] as const
                                        ).map((option) => (
                                            <button
                                                key={option.id}
                                                type="button"
                                                onClick={() => setVoteChoice(option.id)}
                                                className={`ui-button w-full ${
                                                    voteChoice === option.id ? "" : "secondary"
                                                }`}
                                            >
                                                {option.label}
                                            </button>
                                        ))}

                                        <button
                                            type="button"
                                            onClick={() => void handleVote()}
                                            disabled={!voteChoice || voting || !canSignVote}
                                            className="ui-button w-full"
                                        >
                                            {voting ? (
                                                <Loader2 className="animate-spin" size={18} aria-hidden="true" />
                                            ) : null}
                                            {voting ? "Signing vote…" : "Confirm vote"}
                                        </button>
                                        {voteError && (
                                            <p className="text-sm" role="alert">
                                                {voteError}
                                            </p>
                                        )}
                                        <p className="ui-note">
                                            Signs vote:{proposal.id}:yes|no, builds an on-chain tx, and
                                            mirrors after relay. Weight is fixed at 1 per wallet. Abstain is
                                            not supported on-chain.
                                        </p>
                                    </div>
                                </>
                            )}
                        </section>
                    )}

                    {proposal.status === "active" && votingClosed && (
                        <section className="ui-surface">
                            <h2>Close voting</h2>
                            <p className="ui-note mt-2">
                                Voting window ended. Finalize on-chain to set passed/rejected. Treasury
                                payloads still require custody, with no hot-wallet auto-spend.
                            </p>
                            <button
                                type="button"
                                onClick={() => void handleFinalize()}
                                disabled={finalizing}
                                className="ui-button w-full mt-4"
                            >
                                {finalizing ? (
                                    <Loader2 className="animate-spin" size={18} aria-hidden="true" />
                                ) : null}
                                {finalizing ? "Finalizing…" : "Finalize on-chain"}
                            </button>
                            {finalizeError && (
                                <p className="text-sm mt-3" role="alert">
                                    {finalizeError}
                                </p>
                            )}
                        </section>
                    )}

                    <section className="ui-surface">
                        <dl className="ui-detail-list">
                            <div>
                                <dt>Proposer</dt>
                                <dd className="ui-truncate-id" title={proposal.proposer_id}>
                                    {proposal.proposer_id}
                                </dd>
                            </div>
                            <div>
                                <dt>Started</dt>
                                <dd>{shortDate(proposal.start_time)}</dd>
                            </div>
                            <div>
                                <dt>Deadline</dt>
                                <dd>{shortDate(proposal.end_time)}</dd>
                            </div>
                            <div>
                                <dt>Type</dt>
                                <dd>{proposal.type}</dd>
                            </div>
                        </dl>
                    </section>
                </div>
            </div>
        </div>
    );
}
