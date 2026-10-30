import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  SendTransactionError,
  type SendOptions,
  type TransactionSignature,
} from "@solana/web3.js";
import bs58 from "bs58";

export type WalletSigners = {
  publicKey: PublicKey;
  signTransaction?: (tx: Transaction) => Promise<Transaction>;
  sendTransaction?: (
    tx: Transaction,
    connection: Connection,
    options?: SendOptions,
  ) => Promise<TransactionSignature>;
};

const DEFAULT_SEND_OPTIONS: SendOptions = {
  skipPreflight: false,
  preflightCommitment: "confirmed",
  maxRetries: 5,
};

export class SolTransferFailedError extends Error {
  readonly signature: TransactionSignature;
  constructor(signature: TransactionSignature) {
    super(
      `Transfer ${signature} failed on chain. Review a new payment before retrying.`,
    );
    this.name = "SolTransferFailedError";
    this.signature = signature;
  }
}
export class SolTransferRejectedError extends SolTransferFailedError {
  constructor(signature: TransactionSignature) {
    super(signature);
    this.name = "SolTransferRejectedError";
    this.message = "The wallet transfer was rejected before it could be sent.";
  }
}

/**
 * Send a native SOL transfer using the connected wallet.
 * Prefers signTransaction + sendRawTransaction (more reliable with Ledger / hardware wallets).
 */
export async function sendSolTransfer(
  connection: Connection,
  wallet: WalletSigners,
  to: PublicKey,
  lamports: number,
  onSubmitted?: (signature: TransactionSignature) => void,
  options?: { waitForConfirmation?: boolean },
): Promise<TransactionSignature> {
  if (!Number.isSafeInteger(lamports) || lamports <= 0) {
    throw new Error("Amount is too small");
  }

  const transferIx = SystemProgram.transfer({
    fromPubkey: wallet.publicKey,
    toPubkey: to,
    lamports,
  });

  if (wallet.signTransaction) {
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");
    const tx = new Transaction({
      feePayer: wallet.publicKey,
      recentBlockhash: blockhash,
    }).add(transferIx);

    const signed = await wallet.signTransaction(tx);
    if (!signed.signature)
      throw new Error("The wallet did not approve this transaction.");
    const signature = bs58.encode(signed.signature);
    const serialized = signed.serialize();
    // Retain the signed transaction's identity BEFORE broadcasting. An RPC may
    // accept the payment and lose its response; that must not trigger a new transfer.
    onSubmitted?.(signature);
    try {
      const reported = await connection.sendRawTransaction(
        serialized,
        DEFAULT_SEND_OPTIONS,
      );
      if (reported !== signature)
        throw new Error(
          "The RPC returned an unexpected transaction reference.",
        );
    } catch (error) {
      // Only an explicit preflight simulation rejection proves it was not sent.
      if (
        error instanceof SendTransactionError &&
        /^Simulation failed\./i.test(error.message)
      )
        throw new SolTransferRejectedError(signature);
      throw error;
    }
    if (options?.waitForConfirmation === false) return signature;
    const confirmation = await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      "confirmed",
    );
    if (confirmation.value.err) throw new SolTransferFailedError(signature);
    return signature;
  }

  if (!wallet.sendTransaction) {
    throw new Error("Wallet cannot sign transactions");
  }

  // Let the adapter attach blockhash + sign (Phantom software wallet path).
  const tx = new Transaction().add(transferIx);
  const signature = await wallet.sendTransaction(
    tx,
    connection,
    DEFAULT_SEND_OPTIONS,
  );
  onSubmitted?.(signature);
  if (options?.waitForConfirmation === false) return signature;
  const confirmation = await connection.confirmTransaction(
    signature,
    "confirmed",
  );
  if (confirmation.value.err) throw new SolTransferFailedError(signature);
  return signature;
}

export function formatSolanaWalletError(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err !== null && "message" in err
        ? String((err as { message: unknown }).message)
        : String(err ?? "");

  const lower = raw.toLowerCase();

  if (
    lower.includes("user rejected") ||
    lower.includes("user denied") ||
    lower.includes("cancel")
  ) {
    return "Transaction cancelled in your wallet";
  }

  if (lower.includes("ledger")) {
    return [
      "Hardware wallet (Ledger) could not sign this transfer.",
      "On your Ledger: open the Solana app, set the network to Devnet if this site uses devnet, and enable Blind signing in Solana app settings.",
      "Alternatively connect with Phantom (devnet) without Ledger for local testing.",
    ].join(" ");
  }

  if (
    lower.includes("not authorized") ||
    lower.includes("not been authorized")
  ) {
    return "Wallet not authorized. Disconnect and connect again, then retry";
  }

  if (lower.includes("blockhash") || lower.includes("expired")) {
    return "Transaction expired. Try again";
  }

  if (
    lower.includes("insufficient lamports") ||
    lower.includes("insufficient funds") ||
    lower.includes("no record of a prior credit") ||
    lower.includes("attempt to debit")
  ) {
    const cluster =
      (process.env.NEXT_PUBLIC_SOLANA_NETWORK || "devnet") === "mainnet"
        ? "Mainnet"
        : process.env.NEXT_PUBLIC_SOLANA_NETWORK || "devnet";
    return `Not enough SOL on ${cluster}. Switch Phantom to ${cluster}, fund the wallet, then retry.`;
  }

  return raw || "Transfer failed";
}
