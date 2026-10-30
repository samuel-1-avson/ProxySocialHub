"use client";

import { useState } from "react";
import Link from "next/link";
import type { Wallet, WithdrawalSecurity } from "@/lib/api/wallet";
import { parseSolAmountLamports } from "@/lib/sol-amount";
import { getSolscanTxUrl } from "@/lib/solscan";
import { Modal } from "@/components/patterns/Modal";
import { amount, Status } from "@/components/workspace/Patterns";
import { WalletConnectControl } from "@/components/WalletConnectControl";
import type { useWalletDeposit } from "../hooks/useWalletDeposit";
import type { useWalletWithdraw } from "../hooks/useWalletWithdraw";

type Props = {
  wallet?: Wallet;
  network: string;
  mode: "deposit" | "withdraw";
  connected: boolean;
  matching: boolean;
  canApproveDeposit: boolean;
  canApproveWithdrawal: boolean;
  canLink: boolean;
  onLink: () => void;
  canFund: boolean;
  processing: boolean;
  destination?: string | null;
  security?: WithdrawalSecurity;
  deposit: ReturnType<typeof useWalletDeposit>;
  withdraw: ReturnType<typeof useWalletWithdraw>;
};

export function WalletFunds({
  wallet,
  network,
  mode,
  matching,
  canApproveDeposit,
  canApproveWithdrawal,
  canLink,
  onLink,
  canFund,
  processing,
  destination,
  security,
  deposit,
  withdraw,
}: Props) {
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const address = wallet?.linked_solana_address;
  const depositLamports = parseSolAmountLamports(deposit.depositAmount);
  const withdrawalInput =
    withdraw.pending?.amountInput ?? withdraw.withdrawAmount;
  const withdrawalLamports = parseSolAmountLamports(withdrawalInput);
  const withdrawalAmount = withdrawalLamports ? withdrawalLamports / 1e9 : 0;
  const insufficient =
    !withdraw.pending && withdrawalAmount > (wallet?.balance_sol ?? 0);
  const depositBusy = ["approving", "confirming", "verifying"].includes(
    deposit.phase,
  );
  const withdrawBusy = ["approving", "submitting"].includes(withdraw.phase);
  const withdrawalReady =
    canFund &&
    matching &&
    canApproveWithdrawal &&
    !security?.withdrawal_cooldown_active &&
    !withdraw.pending?.reference &&
    Boolean(withdrawalLamports && withdrawalLamports > 0) &&
    !insufficient;
  return (
    <div className="wallet-funds-layout">
      <section
        className="ui-surface wallet-transfer-form"
        aria-labelledby="transfer-funds-title"
      >
        <div className="wallet-funds-heading">
          <div>
            <h2 id="transfer-funds-title">Account funds</h2>
            <p className="ui-note">Available to withdraw</p>
          </div>
          <strong className="ui-stat-value">
            {wallet ? `${amount(wallet.balance_sol, 9)} SOL` : "…"}
          </strong>
        </div>
        <nav className="wallet-transfer-switch" aria-label="Transfer type">
          <Link
            href="/app/wallet?tab=funds&action=deposit"
            aria-current={mode === "deposit" ? "page" : undefined}
          >
            Deposit
          </Link>
          <Link
            href="/app/wallet?tab=funds&action=withdraw"
            aria-current={mode === "withdraw" ? "page" : undefined}
          >
            Withdraw
          </Link>
        </nav>

        {(deposit.pending || depositBusy) && (
          <section
            className="wallet-transfer-status"
            aria-label="Deposit progress"
          >
            <div role="status">
              <Status tone="neutral">
                {deposit.phase === "approving"
                  ? "Approve in your wallet"
                  : deposit.verifying
                    ? "Adding your account funds"
                    : "Deposit confirmation in progress"}
              </Status>
              <p>
                {deposit.phase === "approving"
                  ? "Your wallet is asking you to approve the transfer."
                  : deposit.verificationPaused
                    ? "This payment needs an account review. Its reference is saved; review your wallet activity before making another deposit."
                    : deposit.verificationError
                      ? "Confirmation is taking longer than usual. We saved this payment and will check it again automatically."
                      : "We are confirming your original transfer and updating your account. You can leave this page and return later."}
              </p>
            </div>
            {deposit.pending && (
              <>
                <strong>{deposit.pending.amountInput} SOL deposit</strong>
                <div className="ui-actions">
                  <button
                    className="ui-button secondary small"
                    disabled={depositBusy || processing}
                    onClick={() => void deposit.checkDeposit()}
                  >
                    Check deposit status
                  </button>
                  <a
                    className="ui-link"
                    href={getSolscanTxUrl(deposit.pending.signature)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View transaction ↗
                  </a>
                </div>
                <p className="ui-note">
                  Checking status does not send another payment.
                </p>
              </>
            )}
          </section>
        )}

        {(withdraw.pending || withdrawBusy) && (
          <section
            className="wallet-transfer-status"
            aria-label="Withdrawal progress"
          >
            <div role="status">
              <Status
                tone={
                  withdraw.pending?.status === "ops_required"
                    ? "warning"
                    : "neutral"
                }
              >
                {withdrawBusy
                  ? "Approve your withdrawal"
                  : withdraw.pending?.status === "ops_required"
                    ? "Withdrawal needs review"
                    : withdraw.pending?.reference
                      ? "Withdrawal is processing"
                      : "Resume your previous withdrawal"}
              </Status>
              <p>
                {withdrawBusy
                  ? "Approve this request in your wallet. We handle the payment details for you."
                  : withdraw.pending?.status === "ops_required"
                    ? "Your withdrawal is saved. Review its status in Activity before requesting another."
                    : withdraw.pending?.reference
                      ? withdraw.statusUnavailable
                        ? "The latest status is temporarily unavailable. Your withdrawal is saved and we will keep checking."
                        : "Your request was received. We will update this page when the funds reach your wallet."
                      : "The previous response did not arrive. Resume this saved request with your wallet; it will reuse the original payment reference."}
              </p>
            </div>
            {withdraw.pending && (
              <strong>{withdraw.pending.amountInput} SOL withdrawal</strong>
            )}
            <div className="ui-actions">
              {withdraw.pending?.reference && (
                <button
                  className="ui-button secondary small"
                  disabled={withdraw.checkingStatus || processing}
                  onClick={() => void withdraw.checkWithdrawal()}
                >
                  Check withdrawal status
                </button>
              )}
              <Link className="ui-link" href="/app/wallet?tab=history">
                View activity →
              </Link>
            </div>
          </section>
        )}

        {!matching && (
          <div className="wallet-funds-connect">
            <h3>
              {address
                ? "Connect your linked wallet"
                : "Connect and link a wallet"}
            </h3>
            <p>
              {address
                ? "Use the wallet saved to your account to approve a deposit or withdrawal."
                : "Choose a Solana wallet and link it to your account to get started."}
            </p>
            <WalletConnectControl
              linkedAddress={address}
              canLink={canLink}
              onLink={onLink}
              processing={processing}
              signingReady={canApproveDeposit}
            />
          </div>
        )}

        {mode === "deposit" ? (
          <>
            <div>
              <h3>Deposit from your wallet</h3>
              <p className="ui-note">
                Choose an amount. Approve it in your wallet, and we will confirm
                the transfer and add your account funds automatically.
              </p>
            </div>
            <label className="ui-field" htmlFor="account-deposit-amount">
              Deposit amount (SOL)
            </label>
            <div className="wallet-amount-input">
              <input
                id="account-deposit-amount"
                className="ui-input"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                aria-describedby="deposit-amount-help"
                value={deposit.depositAmount}
                disabled={processing || Boolean(deposit.pending)}
                onChange={(event) =>
                  deposit.setDepositAmount(event.target.value)
                }
              />
              <span aria-hidden="true">SOL</span>
            </div>
            <p id="deposit-amount-help" className="ui-note">
              Keep some SOL in your wallet for the network fee, which your
              wallet shows before approval.
            </p>
            {!destination && (
              <p className="ui-note" role="status">
                Deposit setup is unavailable. Please try again shortly.
              </p>
            )}
            {matching && !canApproveDeposit && (
              <p className="ui-note">
                Choose a wallet that supports transaction approval to deposit.
              </p>
            )}
            <button
              className="ui-button block"
              disabled={
                !canFund ||
                !matching ||
                !canApproveDeposit ||
                !depositLamports ||
                !destination ||
                Boolean(deposit.pending)
              }
              onClick={deposit.initiateDeposit}
            >
              {depositBusy ? "Deposit in progress…" : "Review deposit"}
            </button>
            {!matching && Boolean(depositLamports) && (
              <p className="ui-note" role="status">
                Connect your linked wallet above to enable deposit review.
              </p>
            )}
            {matching && !destination && (
              <p className="ui-note" role="status">
                Deposit review needs the account deposit destination, which is
                unavailable right now.
              </p>
            )}
          </>
        ) : (
          <>
            <div>
              <h3>Withdraw to your wallet</h3>
              <p className="ui-note">
                Withdraw your account funds to your linked Solana wallet.
                Approve the request in your wallet; we prepare and track the
                payout.
              </p>
            </div>
            <label className="ui-field" htmlFor="account-withdrawal-amount">
              Withdrawal amount (SOL)
            </label>
            <div className="wallet-amount-input">
              <input
                id="account-withdrawal-amount"
                className="ui-input"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                aria-describedby="withdrawal-amount-help"
                aria-invalid={insufficient}
                value={withdrawalInput}
                disabled={processing || Boolean(withdraw.pending)}
                onChange={(event) =>
                  withdraw.setWithdrawAmount(event.target.value)
                }
              />
              <span aria-hidden="true">SOL</span>
            </div>
            <p
              id="withdrawal-amount-help"
              className={insufficient ? "ui-error" : "ui-note"}
            >
              {insufficient
                ? "This amount exceeds your available account funds."
                : "The destination is your linked wallet. You do not need to enter payment references."}
            </p>
            {address && (
              <div className="wallet-transfer-destination">
                <span>To your linked wallet</span>
                <code>{address}</code>
              </div>
            )}
            {security?.withdrawal_cooldown_active && (
              <p className="ui-attention" role="status">
                Your withdrawal address changed recently. Withdrawals become
                available{" "}
                {security.withdrawal_cooldown_until
                  ? new Date(
                      security.withdrawal_cooldown_until,
                    ).toLocaleString()
                  : "when the security hold ends"}
                .
              </p>
            )}
            {matching && !canApproveWithdrawal && (
              <p className="ui-note">
                Choose a wallet that supports approval messages to withdraw.
              </p>
            )}
            <button
              className="ui-button block"
              disabled={!withdrawalReady}
              onClick={() => setWithdrawOpen(true)}
            >
              {withdrawBusy
                ? "Withdrawal in progress…"
                : withdraw.pending && !withdraw.pending.reference
                  ? "Resume withdrawal"
                  : "Review withdrawal"}
            </button>
            {!matching && Boolean(withdrawalLamports) && (
              <p className="ui-note" role="status">
                Connect your linked wallet above to enable withdrawal review.
              </p>
            )}
          </>
        )}
        <details className="wallet-transfer-details">
          <summary>Transfer details</summary>
          <dl className="ui-detail-list">
            <div>
              <dt>Payment network</dt>
              <dd>{network}</dd>
            </div>
            <div>
              <dt>
                {mode === "deposit"
                  ? "Deposit destination"
                  : "Withdrawal destination"}
              </dt>
              <dd>
                <code>
                  {mode === "deposit"
                    ? destination || "Unavailable"
                    : address || "Link a wallet first"}
                </code>
              </dd>
            </div>
          </dl>
        </details>
      </section>
      <aside className="wallet-transfer-help">
        <h2>One approval. We handle the rest.</h2>
        <ol>
          <li>
            <strong>Choose your amount</strong>
            <p>Use the Deposit or Withdraw option for your account funds.</p>
          </li>
          <li>
            <strong>Approve in your wallet</strong>
            <p>Review the amount and destination before approving.</p>
          </li>
          <li>
            <strong>Follow the progress</strong>
            <p>
              Confirmation and account updates happen automatically. Activity
              keeps your payment records.
            </p>
          </li>
        </ol>
        <Link className="ui-link" href="/app/wallet?tab=history">
          View wallet activity →
        </Link>
        <p className="ui-note">
          Marketplace purchases use each order’s escrow. You do not need an
          account deposit to buy bandwidth.
        </p>
      </aside>
      <Modal
        open={deposit.showDepositConfirm}
        onOpenChange={(open) =>
          !processing && deposit.setShowDepositConfirm(open)
        }
        title="Review account deposit"
        description="Your connected wallet will ask you to approve this transfer. Confirmation and account credit are automatic."
      >
        <dl className="ui-detail-list">
          <div>
            <dt>Deposit amount</dt>
            <dd>{deposit.depositAmount} SOL</dd>
          </div>
          <div>
            <dt>Network</dt>
            <dd>{network}</dd>
          </div>
          <div>
            <dt>From your wallet</dt>
            <dd>{address}</dd>
          </div>
          <div>
            <dt>To your account funds</dt>
            <dd>{destination}</dd>
          </div>
        </dl>
        <button
          className="ui-button block mt-4"
          disabled={
            processing ||
            !canFund ||
            !matching ||
            !canApproveDeposit ||
            Boolean(deposit.pending)
          }
          onClick={() => void deposit.handleDepositSol()}
        >
          Confirm deposit in wallet
        </button>
      </Modal>
      <Modal
        open={withdrawOpen}
        onOpenChange={(open) => !processing && setWithdrawOpen(open)}
        title="Review account withdrawal"
        description="Approve this request in your wallet. We will send the funds to your linked address and track the payout automatically."
      >
        <dl className="ui-detail-list">
          <div>
            <dt>Withdrawal amount</dt>
            <dd>{withdrawalInput} SOL</dd>
          </div>
          <div>
            <dt>Network</dt>
            <dd>{network}</dd>
          </div>
          <div>
            <dt>To your linked wallet</dt>
            <dd>{address}</dd>
          </div>
        </dl>
        <button
          className="ui-button block mt-4"
          disabled={!withdrawalReady}
          onClick={() => {
            setWithdrawOpen(false);
            void withdraw.handleWithdrawSol();
          }}
        >
          Confirm withdrawal in wallet
        </button>
      </Modal>
    </div>
  );
}
