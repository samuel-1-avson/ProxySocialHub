import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, Transaction, SendTransactionError } from "@solana/web3.js";
import bs58 from "bs58";
import {
  sendSolTransfer,
  SolTransferFailedError,
} from "../src/lib/solana-transfer.ts";
const buyer = Keypair.generate();
const destination = Keypair.generate().publicKey;
test("retains the submitted signature before an RPC confirmation timeout", async () => {
  const seen = [];
  const connection = {
    confirmTransaction: async () => {
      seen.push("confirm");
      throw new Error("RPC timeout");
    },
  };
  const wallet = {
    publicKey: buyer.publicKey,
    sendTransaction: async () => "original-signature",
  };
  await assert.rejects(
    sendSolTransfer(connection, wallet, destination, 1, (signature) =>
      seen.push(signature),
    ),
    /RPC timeout/,
  );
  assert.deepEqual(seen, ["original-signature", "confirm"]);
});
test("rejects an on-chain failure instead of reporting a confirmed payment", async () => {
  const connection = {
    confirmTransaction: async () => ({
      value: { err: { InstructionError: [0, "InsufficientFunds"] } },
    }),
  };
  const wallet = {
    publicKey: buyer.publicKey,
    sendTransaction: async () => "failed-signature",
  };
  await assert.rejects(
    sendSolTransfer(connection, wallet, destination, 1),
    (error) =>
      error instanceof SolTransferFailedError &&
      error.signature === "failed-signature",
  );
});
test("retains the signature on the raw signed transaction path", async () => {
  const seen = [];
  let expected;
  const connection = {
    getLatestBlockhash: async () => ({
      blockhash: Keypair.generate().publicKey.toBase58(),
      lastValidBlockHeight: 100,
    }),
    sendRawTransaction: async (bytes) => {
      seen.push("broadcast");
      return bs58.encode(Transaction.from(bytes).signature);
    },
    confirmTransaction: async () => {
      seen.push("confirm");
      return { value: { err: null } };
    },
  };
  const wallet = {
    publicKey: buyer.publicKey,
    signTransaction: async (tx) => {
      tx.sign(buyer);
      expected = bs58.encode(tx.signature);
      return tx;
    },
  };
  const result = await sendSolTransfer(
    connection,
    wallet,
    destination,
    1,
    (signature) => seen.push(signature),
  );
  assert.equal(result, expected);
  assert.deepEqual(seen, [expected, "broadcast", "confirm"]);
});

test("retains the original signed identity even when the broadcast response is lost", async () => {
  const seen = [];
  const connection = {
    getLatestBlockhash: async () => ({
      blockhash: Keypair.generate().publicKey.toBase58(),
      lastValidBlockHeight: 100,
    }),
    sendRawTransaction: async () => {
      seen.push("broadcast");
      throw new Error("Network response lost");
    },
  };
  const wallet = {
    publicKey: buyer.publicKey,
    signTransaction: async (tx) => {
      tx.sign(buyer);
      return tx;
    },
  };
  await assert.rejects(
    sendSolTransfer(connection, wallet, destination, 1, (signature) =>
      seen.push(signature),
    ),
    /Network response lost/,
  );
  assert.equal(bs58.decode(seen[0]).length, 64);
  assert.equal(seen[1], "broadcast");
});

test("an account deposit returns its receipt without waiting on WebSocket confirmation", async () => {
  const seen = [];
  const connection = {
    getLatestBlockhash: async () => ({
      blockhash: Keypair.generate().publicKey.toBase58(),
      lastValidBlockHeight: 100,
    }),
    sendRawTransaction: async (bytes) => {
      seen.push("broadcast");
      return bs58.encode(Transaction.from(bytes).signature);
    },
    confirmTransaction: async () => {
      throw new Error("Must not wait for WebSocket confirmation");
    },
  };
  const wallet = {
    publicKey: buyer.publicKey,
    signTransaction: async (tx) => {
      tx.sign(buyer);
      return tx;
    },
  };
  const signature = await sendSolTransfer(
    connection,
    wallet,
    destination,
    1,
    (value) => seen.push(value),
    { waitForConfirmation: false },
  );
  assert.equal(bs58.decode(signature).length, 64);
  assert.deepEqual(seen, [signature, "broadcast"]);
});

test("a rejected wallet approval never creates a submitted receipt or broadcasts", async () => {
  let submitted = false;
  const connection = {
    getLatestBlockhash: async () => ({
      blockhash: Keypair.generate().publicKey.toBase58(),
      lastValidBlockHeight: 100,
    }),
  };
  const wallet = {
    publicKey: buyer.publicKey,
    signTransaction: async () => {
      throw new Error("User rejected");
    },
  };
  await assert.rejects(
    sendSolTransfer(connection, wallet, destination, 1, () => {
      submitted = true;
    }),
    /User rejected/,
  );
  assert.equal(submitted, false);
});

test("an explicit preflight rejection is safe to distinguish from an unknown network outcome", async () => {
  const connection = {
    getLatestBlockhash: async () => ({
      blockhash: Keypair.generate().publicKey.toBase58(),
      lastValidBlockHeight: 100,
    }),
    sendRawTransaction: async () => {
      throw new SendTransactionError({
        action: "simulate",
        signature: "",
        transactionMessage: "Transaction simulation failed: insufficient funds",
      });
    },
  };
  const wallet = {
    publicKey: buyer.publicKey,
    signTransaction: async (tx) => {
      tx.sign(buyer);
      return tx;
    },
  };
  await assert.rejects(
    sendSolTransfer(connection, wallet, destination, 1),
    (error) =>
      error instanceof SolTransferFailedError &&
      error.name === "SolTransferRejectedError",
  );
});
test("rejects invalid lamports before requesting a wallet signature", async () => {
  for (const amount of [
    0,
    -1,
    1.1,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    await assert.rejects(
      sendSolTransfer({}, { publicKey: buyer.publicKey }, destination, amount),
    );
  }
});
