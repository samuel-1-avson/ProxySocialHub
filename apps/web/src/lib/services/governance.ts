import bs58 from 'bs58';
import { Transaction } from '@solana/web3.js';
import { API_BASE_URL, fetchWithAuth } from './client';

export interface Proposal {
    id: string;
    title: string;
    description: string;
    proposer_id: string;
    type: string;
    status: 'active' | 'passed' | 'rejected' | 'executed' | 'failed';
    start_time: string;
    end_time: string;
    execution_data?: string;
    yes_votes: number;
    no_votes: number;
    votes_for: number;
    votes_against: number;
    votes_abstain: number;
    total_votes: number;
    quorum: number;
    thread_id?: string;
    ipfs_hash?: string;
    actions?: unknown[];
    /** Present when the caller is authenticated and has already voted. */
    my_vote?: {
        choice: 'yes' | 'no' | string;
        power: number;
    };
}

export interface Vote {
    id: string;
    proposal_id: string;
    voter_id: string;
    choice: 'yes' | 'no';
    voting_power: number;
    power?: number;
    signature?: string;
    yes_votes?: number;
    no_votes?: number;
    my_vote?: {
        choice: 'yes' | 'no' | string;
        power: number;
    };
}

export interface GovernanceExecutionReport {
    feature: string;
    ready: boolean;
    status: string;
    message: string;
    program_id?: string;
    oracle_configured?: boolean;
    missing_instructions?: string[];
}

type SignMessageFn = (message: Uint8Array) => Promise<Uint8Array>;
type SignTransactionFn = (tx: Transaction) => Promise<Transaction>;

function humanizeGovernanceBindError(raw: string): string {
    const upper = raw.toUpperCase();
    if (upper.includes('CREATEPROPOSALREQUEST.DESCRIPTION') && upper.includes("'MIN'")) {
        return 'Description must be at least 20 characters.';
    }
    if (upper.includes('CREATEPROPOSALREQUEST.TITLE') && upper.includes("'MIN'")) {
        return 'Title must be at least 5 characters.';
    }
    if (upper.includes('CREATEPROPOSALREQUEST.TITLE') && upper.includes("'MAX'")) {
        return 'Title must be at most 255 characters.';
    }
    if (upper.includes('CREATEPROPOSALREQUEST.DURATION_DAYS')) {
        return 'Voting duration must be between 1 and 14 days.';
    }
    return raw;
}

function governanceErrorMessage(payload: Record<string, unknown>, fallback: string): string {
    const base =
        (typeof payload.message === 'string' && payload.message) ||
        (typeof payload.error === 'string' && payload.error) ||
        (typeof payload.hint === 'string' && payload.hint) ||
        fallback;
    const friendly = humanizeGovernanceBindError(base);
    const details =
        typeof payload.details === 'string'
            ? payload.details
            : typeof payload.detail === 'string'
              ? payload.detail
              : '';
    const withDetails = details && !friendly.includes(details) ? `${friendly} — ${details}` : friendly;
    const exec = payload.governance_execution as GovernanceExecutionReport | undefined;
    if (exec?.message) {
        return `${withDetails} — ${exec.message}`;
    }
    return withDetails;
}

function normalizeMyVote(
    raw: unknown
): Proposal['my_vote'] | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const mv = raw as Record<string, unknown>;
    const choice = String(mv.choice ?? '').toLowerCase();
    if (choice !== 'yes' && choice !== 'no') return undefined;
    return {
        choice,
        power: Number(mv.power ?? 1),
    };
}

function normalizeProposal(raw: Record<string, unknown>): Proposal {
    const yes = Number(raw.yes_votes ?? raw.votes_for ?? 0);
    const no = Number(raw.no_votes ?? raw.votes_against ?? 0);
    const abstain = Number(raw.votes_abstain ?? 0);
    return {
        id: String(raw.id),
        title: String(raw.title ?? ''),
        description: String(raw.description ?? ''),
        proposer_id: String(raw.proposer_id ?? ''),
        type: String(raw.type ?? 'general'),
        status: (raw.status as Proposal['status']) ?? 'active',
        start_time: String(raw.start_time ?? ''),
        end_time: String(raw.end_time ?? ''),
        execution_data:
            typeof raw.execution_data === 'string' ? raw.execution_data : undefined,
        yes_votes: yes,
        no_votes: no,
        votes_for: yes,
        votes_against: no,
        votes_abstain: abstain,
        total_votes: yes + no + abstain,
        quorum: Number(raw.quorum ?? 100),
        thread_id: raw.thread_id ? String(raw.thread_id) : undefined,
        ipfs_hash: raw.ipfs_hash ? String(raw.ipfs_hash) : undefined,
        my_vote: normalizeMyVote(raw.my_vote),
    };
}

export async function getGovernanceExecutionReadiness(): Promise<GovernanceExecutionReport> {
    const response = await fetch(`${API_BASE_URL}/v1/governance/execution-readiness`);
    if (!response.ok) {
        throw new Error('Failed to load governance execution readiness');
    }
    const data = await response.json();
    return (data.governance_execution ?? data) as GovernanceExecutionReport;
}

export async function getProposals(status?: string): Promise<Proposal[]> {
    const url = status
        ? `${API_BASE_URL}/v1/governance/proposals?status=${encodeURIComponent(status)}`
        : `${API_BASE_URL}/v1/governance/proposals`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error('Failed to fetch proposals');
    }
    const data = await response.json();
    const list = (data.proposals ?? []) as Record<string, unknown>[];
    return list.map(normalizeProposal);
}

export async function getProposal(id: string): Promise<Proposal> {
    const url = `${API_BASE_URL}/v1/governance/proposals/${id}`;
    // Prefer auth so optional JWT attaches my_vote; fall back for public viewers.
    let response: Response;
    try {
        response = await fetchWithAuth(url);
    } catch {
        response = await fetch(url);
    }
    if (!response.ok) {
        throw new Error('Failed to fetch proposal');
    }
    const data = (await response.json()) as Record<string, unknown>;
    return normalizeProposal(data);
}

export interface TreasuryTransaction {
    id: string;
    proposal_id: string;
    recipient: string;
    amount: number;
    currency: string;
    description?: string;
    status: string;
    tx_hash?: string;
    created_at: string;
    executed_at?: string;
}

export async function getProposalTreasuryTransactions(
    proposalId: string
): Promise<TreasuryTransaction[]> {
    const response = await fetch(
        `${API_BASE_URL}/v1/governance/proposals/${proposalId}/treasury-transactions`
    );
    if (!response.ok) {
        if (response.status === 404) return [];
        throw new Error('Failed to load treasury audit trail');
    }
    const data = (await response.json()) as {
        treasury_transactions?: TreasuryTransaction[];
    };
    return data.treasury_transactions ?? [];
}

export interface CreateProposalInput {
    title: string;
    description: string;
    durationDays: number;
    type?: string;
    executionData?: unknown;
}

export async function createProposal(input: CreateProposalInput): Promise<Proposal> {
    const body: Record<string, unknown> = {
        title: input.title,
        description: input.description,
        duration_days: input.durationDays,
    };
    if (input.type) {
        body.type = input.type;
    }
    if (input.executionData !== undefined) {
        body.execution_data = input.executionData;
    }

    const response = await fetchWithAuth(`${API_BASE_URL}/v1/governance/proposals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
        const fallback = response.status
            ? `Failed to create proposal (HTTP ${response.status})`
            : 'Failed to create proposal';
        throw new Error(governanceErrorMessage(data, fallback));
    }

    const raw = (data.proposal ?? data) as Record<string, unknown>;
    if (raw.id) {
        return normalizeProposal(raw);
    }
    const proposalId = data.proposal_id;
    if (typeof proposalId === 'string') {
        return getProposal(proposalId);
    }
    throw new Error('Proposal created but response did not include proposal details');
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** @deprecated Use castGovernanceVote for on-chain voting. */
export async function castVote(
    proposalId: string,
    choice: 'yes' | 'no',
    signature: string,
    walletAddress: string,
    onChainTxSig: string
): Promise<Vote> {
    // Mirror lags behind relay acceptance; give confirmation room before failing.
    const mirrorDelaysMs = [800, 1200, 1600, 2000, 2500, 3000, 4000, 5000, 6000];
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= mirrorDelaysMs.length; attempt++) {
        const response = await fetchWithAuth(
            `${API_BASE_URL}/v1/governance/proposals/${proposalId}/vote`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    choice,
                    signature,
                    wallet_address: walletAddress,
                    on_chain_tx_sig: onChainTxSig,
                }),
            }
        );
        const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        if (response.ok || response.status === 202) {
            const myVote = normalizeMyVote(data.my_vote) ?? {
                choice,
                power: Number(data.power ?? 1),
            };
            return {
                id: String(data.id ?? ''),
                proposal_id: proposalId,
                voter_id: '',
                choice,
                voting_power: myVote.power,
                power: myVote.power,
                yes_votes: data.yes_votes != null ? Number(data.yes_votes) : undefined,
                no_votes: data.no_votes != null ? Number(data.no_votes) : undefined,
                my_vote: myVote,
            };
        }

        const message = governanceErrorMessage(data, 'Failed to cast vote');
        lastError = new Error(message);
        const retryable =
            (response.status === 409 &&
                /not finalized|not found for wallet|not visible yet/i.test(message)) ||
            (response.status === 502 &&
                /verify on-chain vote|vote PDA|not found/i.test(message));
        if (retryable && attempt < mirrorDelaysMs.length) {
            await sleep(mirrorDelaysMs[attempt]);
            continue;
        }
        throw lastError;
    }

    throw lastError ?? new Error('Failed to cast vote');
}

export async function castGovernanceVote(
    proposalId: string,
    choice: 'yes' | 'no',
    walletAddress: string,
    signMessage: SignMessageFn,
    signTransaction: SignTransactionFn
): Promise<Vote> {
    const voteMsg = `vote:${proposalId}:${choice}`;
    const encoded = new TextEncoder().encode(voteMsg);
    const sigBytes = await signMessage(encoded);
    const signature = bs58.encode(sigBytes);

    const buildRes = await fetchWithAuth(
        `${API_BASE_URL}/v1/governance/proposals/${proposalId}/vote/build`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                choice,
                signature,
                wallet_address: walletAddress,
            }),
        }
    );
    const buildData = (await buildRes.json().catch(() => ({}))) as Record<string, unknown>;
    if (!buildRes.ok) {
        throw new Error(governanceErrorMessage(buildData, 'Failed to build vote transaction'));
    }

    if (buildData.already_voted) {
        const myVote = normalizeMyVote(buildData.my_vote) ?? {
            choice: String(buildData.choice ?? choice) === 'no' ? 'no' : 'yes',
            power: Number(buildData.power ?? 1),
        };
        // Ensure DB mirror exists for already-on-chain ballots.
        try {
            return await castVote(proposalId, choice, signature, walletAddress, 'already-on-chain');
        } catch {
            return {
                id: '',
                proposal_id: proposalId,
                voter_id: '',
                choice: myVote.choice === 'no' ? 'no' : 'yes',
                voting_power: myVote.power,
                power: myVote.power,
                yes_votes: buildData.yes_votes != null ? Number(buildData.yes_votes) : undefined,
                no_votes: buildData.no_votes != null ? Number(buildData.no_votes) : undefined,
                my_vote: myVote,
            };
        }
    }

    const unsignedB64 = String(buildData.unsigned_transaction_base64 ?? '');
    if (!unsignedB64) {
        throw new Error('Vote build response missing unsigned transaction');
    }

    const tx = Transaction.from(Buffer.from(unsignedB64, 'base64'));
    const signed = await signTransaction(tx);
    const signedB64 = Buffer.from(signed.serialize()).toString('base64');

    let relayData: Record<string, unknown> = {};
    let relayRes: Response | null = null;
    let lastRelayErr = '';
    for (let attempt = 0; attempt < 4; attempt++) {
        if (attempt > 0) {
            await sleep(800 * attempt);
        }
        relayRes = await fetchWithAuth(
            `${API_BASE_URL}/v1/governance/proposals/${proposalId}/vote/relay`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    wallet_address: walletAddress,
                    signed_transaction_base64: signedB64,
                }),
            }
        );
        relayData = (await relayRes.json().catch(() => ({}))) as Record<string, unknown>;
        if (relayRes.ok || relayData.already_voted) {
            break;
        }
        lastRelayErr = governanceErrorMessage(relayData, 'Failed to relay vote transaction');
        const retryable =
            /rate.?limit|too many requests|temporar|429|-32029|blockhash|expired/i.test(
                lastRelayErr
            );
        if (!retryable || attempt === 3) {
            // Prior attempt may have landed the vote PDA — mirror without a fresh relay.
            if (/already|exist|in use|custom program|0x0/i.test(lastRelayErr) || relayData.already_voted) {
                await sleep(800);
                return castVote(proposalId, choice, signature, walletAddress, 'already-on-chain');
            }
            throw new Error(lastRelayErr);
        }
    }

    if (!relayRes || (!relayRes.ok && !relayData.already_voted)) {
        throw new Error(lastRelayErr || 'Failed to relay vote transaction');
    }

    if (relayData.already_voted) {
        await sleep(400);
        return castVote(proposalId, choice, signature, walletAddress, 'already-on-chain');
    }

    const onChainTxSig = String(relayData.tx_sig ?? '');
    if (!onChainTxSig) {
        throw new Error('Vote relay did not return a transaction signature');
    }

    // Give RPC a beat to land the vote PDA before the first mirror attempt.
    await sleep(1000);
    return castVote(proposalId, choice, signature, walletAddress, onChainTxSig);
}

/** Finalize on-chain voting (permissionless after end_slot). Does not auto-spend treasury. */
export async function finalizeProposal(proposalId: string): Promise<{
    status: string;
    tx_sig?: string;
}> {
    const response = await fetchWithAuth(
        `${API_BASE_URL}/v1/governance/proposals/${proposalId}/execute`,
        { method: 'POST' }
    );
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
        throw new Error(governanceErrorMessage(data, 'Failed to finalize proposal'));
    }
    return {
        status: String(data.status ?? data.message ?? 'finalized'),
        tx_sig: typeof data.tx_sig === 'string' ? data.tx_sig : undefined,
    };
}
