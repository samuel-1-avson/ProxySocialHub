package models

// Ledger kind registry (P2 §9): every wallet-ledger `type` written by
// the Credit/Debit locked helpers is one of these constants. String
// literals at call sites made reconciliation grouping and cap logic
// (DepositLedgerTypes) depend on scattered magic strings; new money
// flows must register their kind here.
const (
	LedgerKindTopup                 = TransactionTopup
	LedgerKindUsage                 = TransactionUsage
	LedgerKindPayout                = TransactionPayout
	LedgerKindRefund                = TransactionRefund
	LedgerKindEarning               = TransactionEarning
	LedgerKindDeposit               = "deposit"
	LedgerKindDepositAuto           = "deposit_auto"
	LedgerKindWithdrawalFailedRefund = "withdrawal_failed_refund"
	LedgerKindEscrowAutoRelease     = "escrow_auto_release"
	LedgerKindMilestoneRelease      = "milestone_release"
	LedgerKindReferralReward        = "referral_reward"
	LedgerKindStake                 = "stake"
	LedgerKindUnstake               = "unstake"
	LedgerKindProviderEarning       = "provider_earning"
	LedgerKindPayoutRestore         = "payout_restore"
	LedgerKindP2PSent               = "p2p_sent"
	LedgerKindP2PReceived           = "p2p_received"
	LedgerKindP2PFailedRefund       = "p2p_failed_refund"
	LedgerKindP2PFailedDebit        = "p2p_failed_debit"
)

// AllLedgerKinds is the closed set of registered ledger kinds.
var AllLedgerKinds = []string{
	LedgerKindTopup, LedgerKindUsage, LedgerKindPayout, LedgerKindRefund,
	LedgerKindEarning, LedgerKindDeposit, LedgerKindDepositAuto,
	LedgerKindWithdrawalFailedRefund, LedgerKindEscrowAutoRelease,
	LedgerKindMilestoneRelease, LedgerKindReferralReward, LedgerKindStake,
	LedgerKindUnstake, LedgerKindProviderEarning,
	LedgerKindPayoutRestore, LedgerKindP2PSent, LedgerKindP2PReceived,
	LedgerKindP2PFailedRefund, LedgerKindP2PFailedDebit,
}

// IsKnownLedgerKind reports whether k is a registered ledger kind.
func IsKnownLedgerKind(k string) bool {
	for _, known := range AllLedgerKinds {
		if k == known {
			return true
		}
	}
	return false
}
