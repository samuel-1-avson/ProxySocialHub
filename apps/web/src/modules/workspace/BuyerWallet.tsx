"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import {
  Connection,
  PublicKey,
  clusterApiUrl,
  type Cluster,
} from "@solana/web3.js";
import { useQuery } from "@tanstack/react-query";
import { getWalletTransactionsPage, getWithdrawals } from "@/lib/api/wallet";
import { forceDisconnectSolanaWallet } from "@/lib/solana-wallet-session";
import { parseSolAmountLamports } from "@/lib/sol-amount";
import { explorerHref } from "@/lib/navigation/workspace";
import {
  useWalletPageData,
  useWalletDeposit,
  useWalletWithdraw,
  useWalletLinking,
} from "@/features/wallet";
import { Modal } from "@/components/patterns/Modal";
import {
  PageHeading,
  Loading,
  DataError,
  Stat,
  Status,
  amount,
  shortDate,
} from "@/components/workspace/Patterns";
import { useOrders } from "./queries";

export function BuyerWallet() {
  const params = useSearchParams();
  const tab = ["funds", "history"].includes(params.get("tab") ?? "")
    ? params.get("tab")!
    : "overview";
  const page = useWalletPageData();
  const adapter = useWallet();
  const { connection } = useConnection();
  const orders = useOrders();
  const [inspection, setInspection] = useState<Cluster>(
    page.solanaNetwork as Cluster,
  );
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [cursor, setCursor] = useState<string | undefined>();
  const [cursorHistory, setCursorHistory] = useState<(string | undefined)[]>(
    [],
  );
  const {
    wallet,
    user,
    queryClient,
    processing,
    setProcessing,
    result,
    setResult,
    treasuryConfig,
    largeWithdrawThresholdSOL,
  } = page;
  const deposit = useWalletDeposit({
    wallet,
    treasuryConfig,
    connected: adapter.connected,
    publicKey: adapter.publicKey,
    signTransaction: adapter.signTransaction,
    sendTransaction: adapter.sendTransaction,
    processing,
    setProcessing,
    setResult,
    queryClient,
  });
  const withdraw = useWalletWithdraw({
    wallet,
    connected: adapter.connected,
    publicKey: adapter.publicKey,
    signMessage: adapter.signMessage,
    largeWithdrawThresholdSOL,
    processing,
    setProcessing,
    setResult,
    queryClient,
  });
  const linking = useWalletLinking({
    userId: user?.id,
    publicKey: adapter.publicKey,
    signMessage: adapter.signMessage,
    processing,
    setProcessing,
    setResult,
    queryClient,
    solanaRpcUrl: page.solanaRpcUrl,
    linkedAddress: wallet?.linked_solana_address,
  });
  const address = wallet?.linked_solana_address;
  const chainBalance = useQuery({
    queryKey: ["wallet-chain-balance", user?.id, address, inspection],
    queryFn: async () => {
      const source =
        inspection === page.solanaNetwork
          ? connection
          : new Connection(clusterApiUrl(inspection), "confirmed");
      return (
        (await source.getBalance(new PublicKey(address!), "confirmed")) /
        1_000_000_000
      );
    },
    enabled: Boolean(address),
    staleTime: 30_000,
    retry: 1,
  });
  const history = useQuery({
    queryKey: ["wallet", "history", user?.id, cursor],
    queryFn: () => getWalletTransactionsPage(cursor, 20),
    enabled: tab === "history" && Boolean(user),
  });
  const withdrawals = useQuery({
    queryKey: ["wallet-withdrawals", user?.id],
    queryFn: () => getWithdrawals(20),
    enabled: tab === "history" && Boolean(user),
    refetchInterval: 15_000,
  });
  const matching = Boolean(
    address && adapter.publicKey?.toBase58() === address && adapter.connected,
  );
  const configuredNetwork = inspection === page.solanaNetwork;
  const validDeposit = (parseSolAmountLamports(deposit.depositAmount) ?? 0) > 0;
  const validWithdraw =
    (parseSolAmountLamports(withdraw.withdrawAmount) ?? 0) > 0;
  const ledgerMismatch = Boolean(
    wallet?.solana_network &&
    wallet.solana_network.replace("mainnet-beta", "mainnet") !==
      page.solanaNetwork.replace("mainnet-beta", "mainnet"),
  );
  const canFund = Boolean(
    wallet && configuredNetwork && !ledgerMismatch && !processing,
  );
  const linkedStatus = matching
    ? "Connected · address matches"
    : address
      ? "Wallet linked · not connected"
      : "No wallet linked";
  return (
    <div className="ui-page">
      <PageHeading
        title="Wallet"
        eyebrow="Account utility"
        description="Your connected wallet, account funds, and order escrow have distinct purposes."
        actions={
          <Link className="ui-button secondary" href="/app/activity">
            Orders & billing →
          </Link>
        }
      />
      <nav className="ui-tabs" aria-label="Wallet views">
        {[
          ["overview", "Overview & linking"],
          ["funds", "Account funds"],
          ["history", "Activity"],
        ].map(([key, label]) => (
          <Link
            key={key}
            href={key === "overview" ? "/app/wallet" : `/app/wallet?tab=${key}`}
            className={tab === key ? "active" : ""}
            aria-current={tab === key ? "page" : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>
      <div className="ui-actions">
        <label className="ui-field">
          Balance network
          <select
            className="ui-select"
            value={inspection}
            onChange={(e) => setInspection(e.target.value as Cluster)}
          >
            <option value="devnet">Devnet</option>
            <option value="testnet">Testnet</option>
            <option value="mainnet-beta">Mainnet</option>
          </select>
        </label>
        <p className="ui-note">
          Purchases and account transfers settle on{" "}
          <strong>{page.solanaNetwork}</strong>. Changing this balance view does
          not change settlement.
        </p>
      </div>
      {!configuredNetwork && (
        <p className="ui-attention" role="status">
          You are inspecting another network. Return to {page.solanaNetwork} to
          use account funding controls.
        </p>
      )}
      {ledgerMismatch && (
        <DataError
          error={
            new Error(
              "The account network and application settlement network differ. Funding is unavailable until they match.",
            )
          }
        />
      )}
      {page.loading && <Loading label="Loading your account wallet…" />}
      {page.walletError && (
        <DataError
          error={page.walletError}
          retry={() =>
            void queryClient.invalidateQueries({ queryKey: ["wallet"] })
          }
        />
      )}
      {result && (
        <div
          className={result.success ? "ui-attention" : "ui-error"}
          role={result.success ? "status" : "alert"}
        >
          <p>{result.message}</p>
          {result.solscanUrl && (
            <a className="ui-link" href={result.solscanUrl}>
              View transaction ↗
            </a>
          )}
        </div>
      )}
      {tab === "overview" && (
        <>
          <section className="ui-stats">
            <Stat
              label="Account funds"
              value={wallet ? `${amount(wallet.balance_sol, 9)} SOL` : "—"}
              detail="Custodial account ledger; separate from escrow"
            />
            <Stat
              label="Linked wallet balance"
              value={
                chainBalance.isSuccess
                  ? `${amount(chainBalance.data, 9)} SOL`
                  : "—"
              }
              detail={`On-chain observation · ${inspection}`}
            />
            <Stat
              label="Active order escrow"
              value={
                orders.isSuccess
                  ? `${orders.data.filter((order) => order.status === "active").length} orders`
                  : "—"
              }
              detail="Inspect each order for its payment record"
            />
          </section>
          {chainBalance.isError && (
            <DataError
              error={chainBalance.error}
              retry={() => void chainBalance.refetch()}
            />
          )}
          <section className="ui-surface ui-page">
            <div className="ui-section-heading">
              <h2>Solana wallet</h2>
              <Status tone={matching ? "good" : "neutral"}>
                {linkedStatus}
              </Status>
            </div>
            <dl className="ui-detail-list">
              <div>
                <dt>Linked account address</dt>
                <dd>{address || "Not linked"}</dd>
              </div>
              <div>
                <dt>Connected address</dt>
                <dd>{adapter.publicKey?.toBase58() || "Not connected"}</dd>
              </div>
            </dl>
            <div className="ui-actions">
              <WalletMultiButton />
              {adapter.connected && (
                <button
                  className="ui-button secondary"
                  disabled={processing}
                  onClick={() =>
                    void forceDisconnectSolanaWallet({
                      disconnect: adapter.disconnect,
                      select: adapter.select,
                    })
                  }
                >
                  Disconnect wallet
                </button>
              )}
              {adapter.connected && !matching && (
                <button
                  className="ui-button"
                  disabled={processing || !wallet || !adapter.signMessage}
                  onClick={() => void linking.handleLinkSolana()}
                >
                  Sign to link this wallet
                </button>
              )}
              {address && (
                <button
                  className="ui-button ghost"
                  disabled={processing}
                  onClick={() => setUnlinkOpen(true)}
                >
                  Unlink address…
                </button>
              )}
            </div>
            <p className="ui-note">
              Linking signs an account-verification challenge. Marketplace
              escrow is funded from this wallet during checkout; account
              deposits are a separate action.
            </p>
            {page.withdrawalSecurity?.withdrawal_cooldown_active && (
              <p className="ui-note">
                A withdrawal-address cooldown is active until{" "}
                {page.withdrawalSecurity.withdrawal_cooldown_until
                  ? new Date(
                      page.withdrawalSecurity.withdrawal_cooldown_until,
                    ).toLocaleString()
                  : "the server clears it"}
                .
              </p>
            )}
          </section>
          <section className="ui-attention">
            <h3>Buying bandwidth</h3>
            <p>
              Open an offer, review its quota, and fund that order’s escrow.
              Account funds are not substituted for the linked wallet’s on-chain
              SOL.
            </p>
            <Link className="ui-link" href="/marketplace">
              Browse proxies →
            </Link>
          </section>
        </>
      )}
      {tab === "funds" && (
        <>
          <section className="ui-surface ui-page">
            <h2>Deposit into account funds</h2>
            {deposit.retainedDeposit && !deposit.depositTxHash && (
              <div className="ui-attention">
                <p>
                  A previous account transfer needs verification before another
                  deposit.
                </p>
                <button
                  className="ui-button secondary"
                  onClick={() => deposit.restoreDeposit()}
                >
                  Resume previous account transfer
                </button>
              </div>
            )}
            <p className="ui-note">
              Use account funds for supported account services. Buying bandwidth
              uses order escrow separately.
            </p>
            <dl className="ui-detail-list">
              <div>
                <dt>Deposit destination</dt>
                <dd>
                  {treasuryConfig?.deposit_address ||
                    treasuryConfig?.treasury_solana ||
                    "Not configured"}
                </dd>
              </div>
              <div>
                <dt>Network</dt>
                <dd>{page.solanaNetwork}</dd>
              </div>
            </dl>
            <label className="ui-field">
              Deposit amount (SOL)
              <input
                className="ui-input"
                inputMode="decimal"
                value={deposit.depositAmount}
                disabled={processing || Boolean(deposit.retainedDeposit)}
                onChange={(e) => deposit.setDepositAmount(e.target.value)}
              />
            </label>
            <div className="ui-actions">
              <button
                className="ui-button"
                disabled={
                  !canFund ||
                  !matching ||
                  !validDeposit ||
                  Boolean(deposit.depositTxHash) ||
                  !treasuryConfig
                }
                onClick={deposit.initiateDeposit}
              >
                Review account deposit
              </button>
              <button
                className="ui-button secondary"
                onClick={() => deposit.setShowManualDeposit((value) => !value)}
                disabled={processing}
              >
                Verify an existing transfer
              </button>
            </div>
            {!matching && (
              <p className="ui-note">
                Connect the linked wallet to approve a new transfer.
              </p>
            )}
            {deposit.showManualDeposit && (
              <div className="ui-page">
                <label className="ui-field">
                  Existing transaction signature
                  <input
                    className="ui-input"
                    value={deposit.depositTxHash}
                    disabled={processing}
                    onChange={(e) =>
                      deposit.setDepositTxHash(e.target.value.trim())
                    }
                  />
                </label>
                <button
                  className="ui-button secondary self-start"
                  disabled={
                    !canFund ||
                    !validDeposit ||
                    !deposit.depositTxHash ||
                    !address
                  }
                  onClick={() => void deposit.handleDepositVerify()}
                >
                  Verify this transfer
                </button>
                <p className="ui-note">
                  Use the original transaction signature after a verification
                  failure. Do not send another transfer to retry account credit.
                </p>
              </div>
            )}
          </section>
          <section className="ui-surface ui-page">
            <h2>Withdraw account funds</h2>
            <p className="ui-note">
              Withdrawals go to your linked address, subject to the server’s
              eligibility and security checks.
            </p>
            <Stat
              label="Account balance"
              value={wallet ? `${amount(wallet.balance_sol, 9)} SOL` : "—"}
              detail="This is not the connected wallet’s on-chain balance"
            />
            <label className="ui-field">
              Withdrawal amount (SOL)
              <input
                className="ui-input"
                inputMode="decimal"
                value={withdraw.withdrawAmount}
                disabled={processing}
                onChange={(e) => withdraw.setWithdrawAmount(e.target.value)}
              />
            </label>
            <button
              className="ui-button self-start"
              disabled={
                !canFund ||
                !address ||
                !validWithdraw ||
                page.withdrawalSecurity?.withdrawal_cooldown_active
              }
              onClick={() => setWithdrawOpen(true)}
            >
              Review withdrawal
            </button>
            {withdraw.pendingWithdrawal && (
              <p className="ui-note" role="status">
                {withdraw.pendingWithdrawal}
              </p>
            )}
          </section>
        </>
      )}
      {tab === "history" && (
        <>
          <section>
            <h2 className="mb-4">Account ledger</h2>
            {history.isLoading && <Loading label="Loading account activity…" />}
            {history.isError && (
              <DataError
                error={history.error}
                retry={() => void history.refetch()}
              />
            )}
            {history.data?.transactions.map((transaction) => (
              <div className="ui-row" key={transaction.id}>
                <div>
                  <h3>{transaction.description || transaction.type}</h3>
                  <p>
                    {shortDate(transaction.created_at)} ·{" "}
                    {transaction.status || "Status not reported"}
                  </p>
                </div>
                <div>
                  <strong>
                    {amount(
                      transaction.amount_lamports != null
                        ? transaction.amount_lamports / 1_000_000_000
                        : transaction.amount,
                      9,
                    )}{" "}
                    SOL
                  </strong>
                  {transaction.tx_hash && (
                    <p>
                      <a
                        className="ui-link"
                        href={explorerHref(
                          `/transactions/${encodeURIComponent(transaction.tx_hash)}`,
                        )}
                      >
                        Transaction ↗
                      </a>
                    </p>
                  )}
                </div>
              </div>
            ))}
            {history.isSuccess && !history.data.transactions.length && (
              <p className="ui-note">
                No account ledger entries were returned.
              </p>
            )}
            <div className="ui-pagination mt-4">
              <button
                className="ui-button secondary"
                disabled={!cursorHistory.length}
                onClick={() => {
                  setCursor(cursorHistory.at(-1));
                  setCursorHistory((current) => current.slice(0, -1));
                }}
              >
                Previous
              </button>
              <button
                className="ui-button secondary"
                disabled={!history.data?.nextCursor}
                onClick={() => {
                  setCursorHistory((current) => [...current, cursor]);
                  setCursor(history.data?.nextCursor);
                }}
              >
                Next
              </button>
            </div>
          </section>
          <section>
            <h2 className="mb-4">Withdrawal status</h2>
            {withdrawals.isError && (
              <DataError
                error={withdrawals.error}
                retry={() => void withdrawals.refetch()}
              />
            )}
            {withdrawals.data?.map((row) => (
              <div className="ui-row" key={row.id}>
                <div>
                  <h3>{amount(row.amount_sol, 9)} SOL</h3>
                  <p>
                    {row.reference} · {row.status}
                  </p>
                </div>
                {row.tx_hash && (
                  <a
                    className="ui-link"
                    href={explorerHref(
                      `/transactions/${encodeURIComponent(row.tx_hash)}`,
                    )}
                  >
                    Transaction ↗
                  </a>
                )}
              </div>
            ))}
            {withdrawals.isSuccess && !withdrawals.data.length && (
              <p className="ui-note">No withdrawal requests were returned.</p>
            )}
          </section>
        </>
      )}
      <Modal
        open={unlinkOpen}
        onOpenChange={setUnlinkOpen}
        title="Unlink the account address?"
        description="Existing orders keep their payment records. A changed withdrawal address may trigger a cooldown."
      >
        <div className="ui-actions">
          <button
            className="ui-button secondary"
            onClick={() => setUnlinkOpen(false)}
          >
            Keep linked
          </button>
          <button
            className="ui-button"
            disabled={processing}
            onClick={async () => {
              await linking.handleUnlinkSolana(() => {});
              setUnlinkOpen(false);
            }}
          >
            Unlink address
          </button>
        </div>
      </Modal>
      <Modal
        open={deposit.showDepositConfirm}
        onOpenChange={deposit.setShowDepositConfirm}
        title="Review account deposit"
        description={`This transfer uses ${page.solanaNetwork} and funds your account ledger.`}
      >
        <dl className="ui-detail-list">
          <div>
            <dt>Amount</dt>
            <dd>{deposit.depositAmount} SOL</dd>
          </div>
          <div>
            <dt>Destination</dt>
            <dd>
              {treasuryConfig?.deposit_address ||
                treasuryConfig?.treasury_solana}
            </dd>
          </div>
        </dl>
        <button
          className="ui-button mt-4"
          disabled={processing || !canFund || !matching}
          onClick={async () => {
            await deposit.handleDepositSol();
            deposit.setShowDepositConfirm(false);
          }}
        >
          Approve in wallet
        </button>
      </Modal>
      <Modal
        open={withdrawOpen}
        onOpenChange={setWithdrawOpen}
        title="Review account withdrawal"
        description="The server checks eligibility before submitting a payout."
      >
        <dl className="ui-detail-list">
          <div>
            <dt>Amount</dt>
            <dd>{withdraw.withdrawAmount} SOL</dd>
          </div>
          <div>
            <dt>Destination</dt>
            <dd>{address || "Not linked"}</dd>
          </div>
          <div>
            <dt>Network</dt>
            <dd>{page.solanaNetwork}</dd>
          </div>
        </dl>
        <p className="ui-note mt-3">
          {withdraw.withdrawRequiresSignature
            ? "A matching wallet signature is required."
            : "The server may require additional authorization."}
        </p>
        <button
          className="ui-button mt-4"
          disabled={processing || !canFund}
          onClick={async () => {
            await withdraw.handleWithdrawSol();
            setWithdrawOpen(false);
          }}
        >
          Submit withdrawal request
        </button>
      </Modal>
    </div>
  );
}
