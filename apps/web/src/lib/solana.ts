import { Program, AnchorProvider, web3, BN, Idl } from '@project-serum/anchor';
import { Connection, PublicKey } from '@solana/web3.js';
import idl from './idl/proxyhub.json';

const DEFAULT_PROGRAM_ID = 'AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu';

/** Avoid build/runtime crashes when .env has placeholders or invalid base58. */
function parseSolanaPubkey(raw: string | undefined, fallback: string): PublicKey {
  const candidate = (raw?.trim().split(/[\s#,]/)[0] || '').trim() || fallback;
  try {
    return new PublicKey(candidate);
  } catch {
    return new PublicKey(fallback);
  }
}

// Constants
const PROGRAM_ID = parseSolanaPubkey(
  process.env.NEXT_PUBLIC_SOLANA_PROGRAM_ID,
  DEFAULT_PROGRAM_ID,
);
const NETWORK = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC || 'https://api.devnet.solana.com';
const RAW_SOLANA_NETWORK = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';
const SOLANA_NETWORK = RAW_SOLANA_NETWORK === 'mainnet' ? 'mainnet-beta' : RAW_SOLANA_NETWORK;
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

const getAssociatedTokenAddress = async (mint: PublicKey, owner: PublicKey): Promise<PublicKey> => {
    const [address] = PublicKey.findProgramAddressSync(
        [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM_ID
    );

    return address;
};

// Types
export type EscrowStatus = 'Pending' | 'Active' | 'Settled' | 'Refunded' | 'Disputed';

export interface EscrowInfo {
    buyer: string;
    seller: string;
    amount: number;
    amountSol: number;
    bandwidthLimitGb: number;
    bandwidthUsedGb: number;
    status: EscrowStatus;
    createdAt: number;
    expiresAt: number;
    pda: string;
}

const STATUS_MAP: EscrowStatus[] = ['Pending', 'Active', 'Settled', 'Refunded', 'Disputed'];

export const getProgram = (wallet: any) => {
    const connection = new Connection(NETWORK, 'processed');
    const provider = new AnchorProvider(
        connection,
        wallet,
        { preflightCommitment: 'processed' }
    );
    return new Program(idl as Idl, PROGRAM_ID, provider);
};

export const getConnection = () => {
    return new Connection(NETWORK, 'processed');
};

// Derive escrow PDA for a buyer-seller pair
export const deriveEscrowPDA = (buyerPubkey: string, sellerPubkey: string) => {
    const buyer = new PublicKey(buyerPubkey);
    const seller = new PublicKey(sellerPubkey);

    const [escrowPda, bump] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("escrow"),
            buyer.toBuffer(),
            seller.toBuffer()
        ],
        PROGRAM_ID
    );

    return { pda: escrowPda.toString(), bump };
};

/** BC-06: escrow_multisig PDA seeds include expires_at (unix seconds). */
export const deriveEscrowMultiSigPDA = (
    buyerPubkey: string,
    sellerPubkey: string,
    expiresAt: number
) => {
    const buyer = new PublicKey(buyerPubkey);
    const seller = new PublicKey(sellerPubkey);
    const tsBuffer = Buffer.alloc(8);
    tsBuffer.writeBigInt64LE(BigInt(expiresAt));
    const [escrowPda, bump] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('escrow_multisig'),
            buyer.toBuffer(),
            seller.toBuffer(),
            tsBuffer,
        ],
        PROGRAM_ID
    );
    return { pda: escrowPda.toString(), bump };
};

export const initializeEscrow = async (
    wallet: any,
    sellerPubkey: string,
    amountLamports: number,
    limitGb: number,
    /** Absolute unix expiry, or a relative duration in seconds if < year 2001. */
    expiresAtOrDurationSeconds: number = 3600 * 24
) => {
    const e2eMockBuy =
        process.env.NEXT_PUBLIC_PLAYWRIGHT_E2E_MOCK_BUY === '1' ||
        (typeof globalThis !== 'undefined' &&
            !!(globalThis as typeof globalThis & { __PROXYHUB_E2E_MOCK_BUY__?: boolean }).__PROXYHUB_E2E_MOCK_BUY__);
    if (e2eMockBuy) {
        return {
            tx: 'e2e-mock-escrow-tx',
            escrowPda: 'e2e-mock-escrow-pda',
            explorerUrl: '#e2e-mock',
        };
    }

    if (!wallet) throw new Error("Wallet not connected");

    // On-chain require!(expires_at > clock.unix_timestamp). Callers historically
    // passed a duration (e.g. 86400); treat small values as relative seconds.
    const nowSec = Math.floor(Date.now() / 1000);
    const expiresAt =
        expiresAtOrDurationSeconds > 1_000_000_000
            ? expiresAtOrDurationSeconds
            : nowSec + Math.max(60, expiresAtOrDurationSeconds);

    const program = getProgram(wallet);
    const buyer = wallet.publicKey;
    const seller = new PublicKey(sellerPubkey);

    // Find PDA
    const [escrowPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("escrow"),
            buyer.toBuffer(),
            seller.toBuffer()
        ],
        program.programId
    );

    console.log("Initializing Escrow PDA:", escrowPda.toString(), "expiresAt:", expiresAt);

    try {
        const tx = await program.methods
            .initializeEscrow(
                new BN(amountLamports),
                new BN(limitGb),
                new BN(expiresAt)
            )
            .accounts({
                buyer: buyer,
                seller: seller,
                escrow: escrowPda,
                systemProgram: web3.SystemProgram.programId,
            })
            .rpc();

        console.log("Escrow Initialized, Tx:", tx);
        return {
            tx,
            escrowPda: escrowPda.toString(),
            explorerUrl: `https://explorer.solana.com/tx/${tx}?cluster=${SOLANA_NETWORK}`
        };

    } catch (err) {
        console.error("Escrow Init Error:", err);
        throw err;
    }
};

/** BC-06: initialize escrow with escrow_multisig seeds (amount-gated path). */
export const initializeEscrowMultisig = async (
    wallet: any,
    sellerPubkey: string,
    amountLamports: number,
    limitGb: number,
    expiresAtUnix: number
) => {
    const e2eMockBuy =
        process.env.NEXT_PUBLIC_PLAYWRIGHT_E2E_MOCK_BUY === '1' ||
        (typeof globalThis !== 'undefined' &&
            !!(globalThis as typeof globalThis & { __PROXYHUB_E2E_MOCK_BUY__?: boolean }).__PROXYHUB_E2E_MOCK_BUY__);
    if (e2eMockBuy) {
        return {
            tx: 'e2e-mock-escrow-multisig-tx',
            escrowPda: 'e2e-mock-escrow-multisig-pda',
            explorerUrl: '#e2e-mock',
        };
    }

    if (!wallet) throw new Error('Wallet not connected');
    if (!expiresAtUnix || expiresAtUnix <= Math.floor(Date.now() / 1000)) {
        throw new Error('escrow_expires_at must be a future unix timestamp');
    }

    const program = getProgram(wallet);
    const buyer = wallet.publicKey;
    const seller = new PublicKey(sellerPubkey);
    const { pda } = deriveEscrowMultiSigPDA(buyer.toBase58(), sellerPubkey, expiresAtUnix);
    const escrowPda = new PublicKey(pda);
    const [programState] = PublicKey.findProgramAddressSync(
        [Buffer.from('program_state')],
        program.programId
    );
    const [priceOracle] = PublicKey.findProgramAddressSync(
        [Buffer.from('price_oracle')],
        program.programId
    );

    console.log('Initializing Multisig Escrow PDA:', escrowPda.toString(), 'expiresAt:', expiresAtUnix);

    try {
        const tx = await program.methods
            .initializeEscrowMultisig(
                new BN(amountLamports),
                new BN(limitGb),
                new BN(expiresAtUnix)
            )
            .accounts({
                buyer,
                seller,
                escrow: escrowPda,
                programState,
                priceOracle,
                systemProgram: web3.SystemProgram.programId,
            })
            .rpc();

        return {
            tx,
            escrowPda: escrowPda.toString(),
            explorerUrl: `https://explorer.solana.com/tx/${tx}?cluster=${SOLANA_NETWORK}`,
        };
    } catch (err) {
        console.error('Multisig Escrow Init Error:', err);
        throw err;
    }
};

/** True when initializeEscrow fails because the buyer/seller PDA already exists. */
export function isEscrowAccountAlreadyInUse(err: unknown): boolean {
    const raw =
        err instanceof Error
            ? err.message
            : typeof err === 'object' && err !== null && 'message' in err
              ? String((err as { message: unknown }).message)
              : String(err ?? '');
    const lower = raw.toLowerCase();
    return lower.includes('already in use') || lower.includes('accountalreadyinus');
}

// Refund an expired escrow (buyer only)
export const refundEscrow = async (
    wallet: any,
    sellerPubkey: string
) => {
    if (!wallet) throw new Error("Wallet not connected");

    const program = getProgram(wallet);
    const buyer = wallet.publicKey;
    const seller = new PublicKey(sellerPubkey);

    // Find PDA
    const [escrowPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("escrow"),
            buyer.toBuffer(),
            seller.toBuffer()
        ],
        program.programId
    );

    console.log("Refunding Escrow PDA:", escrowPda.toString());

    try {
        const tx = await program.methods
            .refundEscrow()
            .accounts({
                buyer: buyer,
                escrow: escrowPda,
            })
            .rpc();

        console.log("Escrow Refunded, Tx:", tx);
        return {
            tx,
            escrowPda: escrowPda.toString(),
            explorerUrl: `https://explorer.solana.com/tx/${tx}?cluster=${SOLANA_NETWORK}`
        };

    } catch (err) {
        console.error("Escrow Refund Error:", err);
        throw err;
    }
};

async function parseEscrowAccount(pda: string): Promise<EscrowInfo | null> {
    const connection = getConnection();
    const escrowPda = new PublicKey(pda);
    try {
        const accountInfo = await connection.getAccountInfo(escrowPda);
        if (!accountInfo || !accountInfo.data) {
            return null;
        }
        const data = accountInfo.data.slice(8);
        if (data.length < 146) {
            console.error('Escrow data too short');
            return null;
        }
        const buyer = new PublicKey(data.slice(0, 32)).toString();
        const seller = new PublicKey(data.slice(32, 64)).toString();
        const amount = Number(data.readBigUInt64LE(64));
        const bandwidthLimitGb = Number(data.readBigUInt64LE(72));
        const bandwidthUsedGb = Number(data.readBigUInt64LE(80));
        const statusIndex = data[88];
        const createdAt = Number(data.readBigInt64LE(89));
        const expiresAt = Number(data.readBigInt64LE(97));
        return {
            buyer,
            seller,
            amount,
            amountSol: amount / 1e9,
            bandwidthLimitGb,
            bandwidthUsedGb,
            status: STATUS_MAP[statusIndex] || 'Pending',
            createdAt,
            expiresAt,
            pda,
        };
    } catch (err) {
        console.error('Error fetching escrow info:', err);
        return null;
    }
}

/** Fetch escrow by exact PDA (legacy or escrow_multisig). */
export const getEscrowInfoByPDA = async (escrowPda: string): Promise<EscrowInfo | null> => {
    return parseEscrowAccount(escrowPda);
};

// Fetch escrow info from on-chain (legacy ["escrow", buyer, seller] PDA)
export const getEscrowInfo = async (
    buyerPubkey: string,
    sellerPubkey: string
): Promise<EscrowInfo | null> => {
    const { pda } = deriveEscrowPDA(buyerPubkey, sellerPubkey);
    return parseEscrowAccount(pda);
};

// Request settlement via backend oracle
export const requestSettlement = async (
    buyerPubkey: string,
    sellerPubkey: string,
    bandwidthUsedGb: number
) => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';

    const response = await fetch(`${apiUrl}/v1/solana/escrow/settle`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            buyer: buyerPubkey,
            seller: sellerPubkey,
            bandwidth_used_gb: bandwidthUsedGb
        })
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Settlement failed');
    }

    return response.json();
};

// ============== SPL TOKEN SUPPORT ==============

// Common token mints
export const TOKEN_MINTS = {
    // USDC on Devnet
    USDC_DEVNET: new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'),
    // USDC on Mainnet
    USDC_MAINNET: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
};

// Get the appropriate USDC mint for the current network
export const getUSDCMint = () => {
    return SOLANA_NETWORK === 'mainnet-beta'
        ? TOKEN_MINTS.USDC_MAINNET
        : TOKEN_MINTS.USDC_DEVNET;
};

// Token escrow info type
export interface TokenEscrowInfo {
    buyer: string;
    seller: string;
    mint: string;
    amount: number;
    amountFormatted: number; // Amount in token decimals (e.g., USDC has 6 decimals)
    bandwidthLimitGb: number;
    bandwidthUsedGb: number;
    status: EscrowStatus;
    createdAt: number;
    expiresAt: number;
    pda: string;
}

// Derive token escrow PDA
export const deriveTokenEscrowPDA = (
    buyerPubkey: string,
    sellerPubkey: string,
    mintPubkey: string
) => {
    const buyer = new PublicKey(buyerPubkey);
    const seller = new PublicKey(sellerPubkey);
    const mint = new PublicKey(mintPubkey);

    const [escrowPda, bump] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("token_escrow"),
            buyer.toBuffer(),
            seller.toBuffer(),
            mint.toBuffer()
        ],
        PROGRAM_ID
    );

    return { pda: escrowPda.toString(), bump };
};

// Derive token vault PDA
export const deriveTokenVaultPDA = (escrowPda: string) => {
    const escrow = new PublicKey(escrowPda);

    const [vaultPda, bump] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("token_vault"),
            escrow.toBuffer()
        ],
        PROGRAM_ID
    );

    return { pda: vaultPda.toString(), bump };
};

// Initialize token escrow (for USDC or other SPL tokens)
export const initializeTokenEscrow = async (
    wallet: any,
    sellerPubkey: string,
    mintPubkey: string,
    amount: number, // In token base units (e.g., for USDC with 6 decimals, 1 USDC = 1_000_000)
    limitGb: number,
    durationSeconds: number = 3600 * 24
) => {
    if (!wallet) throw new Error("Wallet not connected");

    const program = getProgram(wallet);
    const connection = getConnection();
    const buyer = wallet.publicKey;
    const seller = new PublicKey(sellerPubkey);
    const mint = new PublicKey(mintPubkey);

    // Derive PDAs
    const [escrowPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("token_escrow"),
            buyer.toBuffer(),
            seller.toBuffer(),
            mint.toBuffer()
        ],
        program.programId
    );

    const [vaultPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("token_vault"),
            escrowPda.toBuffer()
        ],
        program.programId
    );

    // Get buyer's token account
    const buyerTokenAccount = await getAssociatedTokenAddress(mint, buyer);

    console.log("Initializing Token Escrow PDA:", escrowPda.toString());
    console.log("Vault PDA:", vaultPda.toString());
    console.log("Buyer Token Account:", buyerTokenAccount.toString());

    try {
        const tx = await program.methods
            .initializeTokenEscrow(
                new BN(amount),
                new BN(limitGb),
                new BN(durationSeconds)
            )
            .accounts({
                buyer: buyer,
                seller: seller,
                mint: mint,
                buyerTokenAccount: buyerTokenAccount,
                escrow: escrowPda,
                escrowVault: vaultPda,
                tokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                systemProgram: web3.SystemProgram.programId,
            })
            .rpc();

        console.log("Token Escrow Initialized, Tx:", tx);
        return {
            tx,
            escrowPda: escrowPda.toString(),
            vaultPda: vaultPda.toString(),
            explorerUrl: `https://explorer.solana.com/tx/${tx}?cluster=${SOLANA_NETWORK}`
        };

    } catch (err) {
        console.error("Token Escrow Init Error:", err);
        throw err;
    }
};

// Refund token escrow (buyer only, for expired escrows)
export const refundTokenEscrow = async (
    wallet: any,
    sellerPubkey: string,
    mintPubkey: string
) => {
    if (!wallet) throw new Error("Wallet not connected");

    const program = getProgram(wallet);
    const buyer = wallet.publicKey;
    const seller = new PublicKey(sellerPubkey);
    const mint = new PublicKey(mintPubkey);

    // Derive PDAs
    const [escrowPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("token_escrow"),
            buyer.toBuffer(),
            seller.toBuffer(),
            mint.toBuffer()
        ],
        program.programId
    );

    const [vaultPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("token_vault"),
            escrowPda.toBuffer()
        ],
        program.programId
    );

    // Get buyer's token account
    const buyerTokenAccount = await getAssociatedTokenAddress(mint, buyer);

    console.log("Refunding Token Escrow:", escrowPda.toString());

    try {
        const tx = await program.methods
            .refundTokenEscrow()
            .accounts({
                buyer: buyer,
                escrow: escrowPda,
                escrowVault: vaultPda,
                buyerTokenAccount: buyerTokenAccount,
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .rpc();

        console.log("Token Escrow Refunded, Tx:", tx);
        return {
            tx,
            escrowPda: escrowPda.toString(),
            explorerUrl: `https://explorer.solana.com/tx/${tx}?cluster=${SOLANA_NETWORK}`
        };

    } catch (err) {
        console.error("Token Escrow Refund Error:", err);
        throw err;
    }
};

// Helper to format token amounts based on decimals
export const formatTokenAmount = (amount: number, decimals: number = 6) => {
    return amount / Math.pow(10, decimals);
};

// Helper to parse token amounts to base units
export const parseTokenAmount = (amount: number, decimals: number = 6) => {
    return Math.floor(amount * Math.pow(10, decimals));
};

// ============== DISPUTE RESOLUTION ==============

export type DisputeStatus = 'Open' | 'Resolved' | 'Cancelled';

export interface DisputeInfo {
    escrow: string;
    initiator: string;
    isBuyer: boolean;
    reason: string;
    status: DisputeStatus;
    createdAt: number;
    resolvedAt: number;
    resolution: string;
    buyerPayout: number;
    sellerPayout: number;
    pda: string;
}

// Derive dispute PDA from escrow
export const deriveDisputePDA = (escrowPda: string) => {
    const escrow = new PublicKey(escrowPda);

    const [disputePda, bump] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("dispute"),
            escrow.toBuffer()
        ],
        PROGRAM_ID
    );

    return { pda: disputePda.toString(), bump };
};

// Raise a dispute on an escrow (buyer or seller can call)
export const raiseDispute = async (
    wallet: any,
    sellerPubkey: string,
    reason: string
) => {
    if (!wallet) throw new Error("Wallet not connected");

    const program = getProgram(wallet);
    const initiator = wallet.publicKey;
    const seller = new PublicKey(sellerPubkey);

    // The buyer is the initiator (we can also support seller initiating)
    const buyer = initiator;

    // Derive escrow PDA
    const [escrowPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("escrow"),
            buyer.toBuffer(),
            seller.toBuffer()
        ],
        program.programId
    );

    // Derive dispute PDA
    const [disputePda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("dispute"),
            escrowPda.toBuffer()
        ],
        program.programId
    );

    console.log("Raising dispute on escrow:", escrowPda.toString());
    console.log("Dispute PDA:", disputePda.toString());

    try {
        const tx = await program.methods
            .raiseDispute(reason)
            .accounts({
                initiator: initiator,
                escrow: escrowPda,
                dispute: disputePda,
                systemProgram: web3.SystemProgram.programId,
            })
            .rpc();

        console.log("Dispute Raised, Tx:", tx);
        return {
            tx,
            escrowPda: escrowPda.toString(),
            disputePda: disputePda.toString(),
            explorerUrl: `https://explorer.solana.com/tx/${tx}?cluster=${SOLANA_NETWORK}`
        };

    } catch (err) {
        console.error("Raise Dispute Error:", err);
        throw err;
    }
};

// Request dispute resolution via backend.
// @deprecated W1.2 — centralized `/v1/solana/dispute/resolve` is not registered.
// Use `/v1/disputes/jury/*` (create → vote → on-chain settle via oracle shortcut).
export const requestDisputeResolution = async (
    _escrowPda: string,
    _buyerPercentage: number,
    _resolution: string
) => {
    throw new Error(
        'Centralized dispute resolve is disabled. Use /v1/disputes/jury/* for jury settlement.'
    );
};
