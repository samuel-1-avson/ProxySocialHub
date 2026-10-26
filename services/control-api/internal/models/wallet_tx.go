package models

import (
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/decentralization"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// LockWalletForUpdate loads a wallet with SELECT FOR UPDATE inside an open transaction.
func LockWalletForUpdate(tx *gorm.DB, userID uuid.UUID) (*Wallet, error) {
	var w Wallet
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("user_id = ?", userID).
		First(&w).Error; err != nil {
		return nil, err
	}
	return &w, nil
}

// LedgerOpts optional fields for Credit/Debit helpers.
type LedgerOpts struct {
	TxHash string
	// JournalKind overrides default journal mapping: "", "treasury", "deposit_vault", "stake", "unstake", "skip".
	// JournalKind "skip" disables the per-leg dual-write; the caller MUST PostBalancedJournal /
	// PostUsageJournal (or equivalent) in the SAME DB transaction. New skip sites must be added
	// to journal_skip_sites_test.go allowlist.
	JournalKind string
}

// CreditWalletLocked credits amount using lamports math, appends a ledger row, and dual-writes journal.
func CreditWalletLocked(tx *gorm.DB, wallet *Wallet, amount float64, entryType, referenceID, description string) error {
	return CreditWalletLockedOpts(tx, wallet, amount, entryType, referenceID, description, LedgerOpts{})
}

// CreditWalletLockedOpts is CreditWalletLocked with optional tx hash / journal kind.
func CreditWalletLockedOpts(tx *gorm.DB, wallet *Wallet, amount float64, entryType, referenceID, description string, opts LedgerOpts) error {
	return CreditWalletLockedLamports(tx, wallet, int64(SOLToLamports(amount)), entryType, referenceID, description, opts)
}

// CreditWalletLockedLamports credits an exact lamports delta (Sprint I / DB-02 lite).
// BalanceSOL is derived from BalanceLamports for legacy float columns only.
// When PROXYHUB_JOURNAL_AS_SOT=true, journal posts first (fail-closed); wallet is cache.
func CreditWalletLockedLamports(tx *gorm.DB, wallet *Wallet, lamports int64, entryType, referenceID, description string, opts LedgerOpts) error {
	if lamports <= 0 {
		return fmt.Errorf("credit lamports must be positive")
	}
	if decentralization.JournalAsSoTEnabled() {
		if err := postCreditJournal(tx, wallet.ID, lamports, entryType, referenceID, description, opts.JournalKind); err != nil {
			return fmt.Errorf("journal-as-sot credit journal: %w", err)
		}
	}
	wallet.CreditLamports(lamports)
	if entryType == "provider_earning" {
		wallet.EarningsPayableLamports += lamports
	}
	if err := tx.Model(wallet).Updates(map[string]interface{}{
		"balance_sol":               wallet.BalanceSOL,
		"balance_lamports":          wallet.BalanceLamports,
		"earnings_payable_lamports": wallet.EarningsPayableLamports,
	}).Error; err != nil {
		return err
	}
	entry := WalletLedgerEntry{
		WalletID:             wallet.ID,
		Amount:               LamportsToSOL(uint64(lamports)),
		BalanceAfter:         wallet.BalanceSOL,
		AmountLamports:       lamports,
		BalanceAfterLamports: wallet.BalanceLamports,
		Type:                 entryType,
		ReferenceID:          referenceID,
		TxHash:               opts.TxHash,
		Description:          description,
		CreatedAt:            time.Now().UTC(),
	}
	if err := tx.Create(&entry).Error; err != nil {
		return err
	}
	if !decentralization.JournalAsSoTEnabled() {
		if err := postCreditJournal(tx, wallet.ID, lamports, entryType, referenceID, description, opts.JournalKind); err != nil {
			return fmt.Errorf("dual-write credit journal: %w", err)
		}
	}
	return nil
}

// DebitWalletLocked debits amount using lamports math, appends a ledger row, and dual-writes journal.
func DebitWalletLocked(tx *gorm.DB, wallet *Wallet, amount float64, entryType, referenceID, description string) error {
	return DebitWalletLockedOpts(tx, wallet, amount, entryType, referenceID, description, LedgerOpts{})
}

// DebitWalletLockedOpts is DebitWalletLocked with optional tx hash / journal kind.
func DebitWalletLockedOpts(tx *gorm.DB, wallet *Wallet, amount float64, entryType, referenceID, description string, opts LedgerOpts) error {
	return DebitWalletLockedLamports(tx, wallet, int64(SOLToLamports(amount)), entryType, referenceID, description, opts)
}

// ErrInsufficientBalance (errors.go) marks a business (non-infrastructure)
// debit failure; settlement must not count it toward RPC breakers (W-17).

// DebitWalletLockedLamports debits an exact lamports delta (Sprint I / DB-02 lite).
// When PROXYHUB_JOURNAL_AS_SOT=true, journal posts first (fail-closed); wallet is cache.
func DebitWalletLockedLamports(tx *gorm.DB, wallet *Wallet, lamports int64, entryType, referenceID, description string, opts LedgerOpts) error {
	if lamports <= 0 {
		return fmt.Errorf("debit lamports must be positive")
	}
	have := wallet.EffectiveBalanceLamports()
	if have < lamports {
		return fmt.Errorf("%w: have %d lamports, need %d", ErrInsufficientBalance, have, lamports)
	}
	if decentralization.JournalAsSoTEnabled() {
		if err := postDebitJournal(tx, wallet.ID, lamports, entryType, referenceID, description, opts.JournalKind); err != nil {
			return fmt.Errorf("journal-as-sot debit journal: %w", err)
		}
	}
	if !wallet.DebitLamports(lamports) {
		return fmt.Errorf("%w: have %d lamports, need %d", ErrInsufficientBalance, have, lamports)
	}
	wallet.clampPayableToBalance()
	if err := tx.Model(wallet).Updates(map[string]interface{}{
		"balance_sol":               wallet.BalanceSOL,
		"balance_lamports":          wallet.BalanceLamports,
		"earnings_payable_lamports": wallet.EarningsPayableLamports,
	}).Error; err != nil {
		return err
	}
	entry := WalletLedgerEntry{
		WalletID:             wallet.ID,
		Amount:               -LamportsToSOL(uint64(lamports)),
		BalanceAfter:         wallet.BalanceSOL,
		AmountLamports:       -lamports,
		BalanceAfterLamports: wallet.BalanceLamports,
		Type:                 entryType,
		ReferenceID:          referenceID,
		TxHash:               opts.TxHash,
		Description:          description,
		CreatedAt:            time.Now().UTC(),
	}
	if err := tx.Create(&entry).Error; err != nil {
		return err
	}
	if !decentralization.JournalAsSoTEnabled() {
		if err := postDebitJournal(tx, wallet.ID, lamports, entryType, referenceID, description, opts.JournalKind); err != nil {
			return fmt.Errorf("dual-write debit journal: %w", err)
		}
	}
	return nil
}

// TransferP2PLocked debits sender and credits recipient with one balanced P2P journal.
func TransferP2PLocked(tx *gorm.DB, sender, recipient *Wallet, amount float64, ref, senderDesc, recipientDesc string) error {
	if amount <= 0 {
		return fmt.Errorf("transfer amount must be positive")
	}
	delta := int64(SOLToLamports(amount))
	if !sender.DebitSOL(amount) {
		return fmt.Errorf("insufficient SOL balance: have %.9f, need %.9f", sender.BalanceSOL, amount)
	}
	recipient.CreditSOL(amount)
	// W-19: DebitSOL/CreditSOL already maintain lamports exactly; do NOT
	// recompute lamports from the float shadow (precision round-trip).
	// W-10: sender spending draws non-earnings first (clamp handles it);
	// a P2P credit is never earnings, so recipient payable is unchanged.
	sender.clampPayableToBalance()
	if err := tx.Model(sender).Updates(map[string]interface{}{
		"balance_sol": sender.BalanceSOL, "balance_lamports": sender.BalanceLamports,
		"earnings_payable_lamports": sender.EarningsPayableLamports,
	}).Error; err != nil {
		return err
	}
	if err := tx.Model(recipient).Updates(map[string]interface{}{
		"balance_sol": recipient.BalanceSOL, "balance_lamports": recipient.BalanceLamports,
		"earnings_payable_lamports": recipient.EarningsPayableLamports,
	}).Error; err != nil {
		return err
	}
	now := time.Now().UTC()
	if err := tx.Create(&WalletLedgerEntry{
		WalletID: sender.ID, Amount: -amount, BalanceAfter: sender.BalanceSOL,
		AmountLamports: -delta, BalanceAfterLamports: sender.BalanceLamports,
		Type: LedgerKindP2PSent, ReferenceID: ref, Description: senderDesc, CreatedAt: now,
	}).Error; err != nil {
		return err
	}
	if err := tx.Create(&WalletLedgerEntry{
		WalletID: recipient.ID, Amount: amount, BalanceAfter: recipient.BalanceSOL,
		AmountLamports: delta, BalanceAfterLamports: recipient.BalanceLamports,
		Type: LedgerKindP2PReceived, ReferenceID: ref, Description: recipientDesc, CreatedAt: now,
	}).Error; err != nil {
		return err
	}
	return postP2PJournal(tx, sender.ID, recipient.ID, delta, "p2p", ref, senderDesc)
}

func postCreditJournal(tx *gorm.DB, walletID uuid.UUID, lamports int64, entryType, ref, desc, kind string) error {
	if kind == "skip" {
		return nil
	}
	if entryType == LedgerKindPayoutRestore {
		return postPayableCreditJournal(tx, walletID, lamports, entryType, ref, desc)
	}
	if kind == "unstake" || entryType == "unstake" {
		return postUnstakeJournal(tx, walletID, lamports, entryType, ref, desc)
	}
	if kind == "deposit_vault" {
		return postUserCreditJournalFromVault(tx, walletID, lamports, entryType, ref, desc)
	}
	return postUserCreditJournal(tx, walletID, lamports, entryType, ref, desc)
}

func postDebitJournal(tx *gorm.DB, walletID uuid.UUID, lamports int64, entryType, ref, desc, kind string) error {
	if kind == "skip" {
		return nil
	}
	if kind == "payable" {
		return postPayableDebitJournal(tx, walletID, lamports, entryType, ref, desc)
	}
	if kind == "stake" || entryType == "stake" {
		return postStakeJournal(tx, walletID, lamports, entryType, ref, desc)
	}
	return postUserDebitJournal(tx, walletID, lamports, entryType, ref, desc)
}

// DebitEarningsPayable debits lamports from the wallet AND from the
// earnings-payable sub-balance (W-10). Payout paths must use this - a
// plain debit would sweep buyer funds and strand the payable tag.
func DebitEarningsPayable(tx *gorm.DB, wallet *Wallet, lamports int64, referenceID, description string) error {
	if lamports <= 0 {
		return fmt.Errorf("payable debit lamports must be positive")
	}
	if wallet.PayableLamports() < lamports {
		return fmt.Errorf("%w: payable %d lamports, need %d", ErrInsufficientBalance, wallet.PayableLamports(), lamports)
	}
	if err := DebitWalletLockedLamports(tx, wallet, lamports, TransactionPayout, referenceID, description, LedgerOpts{JournalKind: "payable"}); err != nil {
		return err
	}
	wallet.EarningsPayableLamports -= lamports
	if wallet.EarningsPayableLamports < 0 {
		wallet.EarningsPayableLamports = 0
	}
	return tx.Model(wallet).Update("earnings_payable_lamports", wallet.EarningsPayableLamports).Error
}

// CreditEarningsPayableRestore reverses a payout debit (enqueue/send
// failure before durable handoff): balance and payable both restored.
func CreditEarningsPayableRestore(tx *gorm.DB, wallet *Wallet, lamports int64, referenceID, description string) error {
	if err := CreditWalletLockedLamports(tx, wallet, lamports, "payout_restore", referenceID, description, LedgerOpts{}); err != nil {
		return err
	}
	wallet.EarningsPayableLamports += lamports
	wallet.clampPayableToBalance()
	return tx.Model(wallet).Update("earnings_payable_lamports", wallet.EarningsPayableLamports).Error
}
