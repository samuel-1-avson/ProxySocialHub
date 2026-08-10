package models

import (
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Chart of accounts codes (seeded in 000124).
const (
	AccountTreasuryCash        = "1000"
	AccountDepositVaultCash    = "1001"
	AccountUserWalletLiability = "2100"
	AccountEscrowLiability     = "2200"
	AccountPlatformRevenue     = "4000"
)

// LedgerAccount is a chart-of-accounts row.
type LedgerAccount struct {
	Code        string    `gorm:"column:code;primaryKey" json:"code"`
	Name        string    `gorm:"column:name" json:"name"`
	AccountType string    `gorm:"column:account_type" json:"account_type"`
	CreatedAt   time.Time `json:"created_at"`
}

func (LedgerAccount) TableName() string { return "ledger_accounts" }

// LedgerJournal is a double-entry journal header.
type LedgerJournal struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	ExternalRef string    `gorm:"column:external_ref" json:"external_ref,omitempty"`
	EntryType   string    `gorm:"column:entry_type" json:"entry_type"`
	Description string    `gorm:"column:description" json:"description,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}

func (LedgerJournal) TableName() string { return "ledger_journals" }

func (j *LedgerJournal) BeforeCreate(tx *gorm.DB) error {
	if j.ID == uuid.Nil {
		j.ID = uuid.New()
	}
	if j.CreatedAt.IsZero() {
		j.CreatedAt = time.Now().UTC()
	}
	return nil
}

// LedgerJournalLine is one debit/credit line (amount_lamports >0 debit, <0 credit).
type LedgerJournalLine struct {
	ID             uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	JournalID      uuid.UUID  `gorm:"type:uuid;not null" json:"journal_id"`
	AccountCode    string     `gorm:"column:account_code;size:16;not null" json:"account_code"`
	WalletID       *uuid.UUID `gorm:"type:uuid" json:"wallet_id,omitempty"`
	AmountLamports int64      `gorm:"column:amount_lamports;not null" json:"amount_lamports"`
	CreatedAt      time.Time  `json:"created_at"`
}

func (LedgerJournalLine) TableName() string { return "ledger_journal_lines" }

func (l *LedgerJournalLine) BeforeCreate(tx *gorm.DB) error {
	if l.ID == uuid.Nil {
		l.ID = uuid.New()
	}
	if l.CreatedAt.IsZero() {
		l.CreatedAt = time.Now().UTC()
	}
	return nil
}

// JournalLineSpec is an in-memory line before persistence.
type JournalLineSpec struct {
	AccountCode    string
	WalletID       *uuid.UUID
	AmountLamports int64 // >0 debit, <0 credit
}

// PostBalancedJournal inserts a journal header + balanced lines in the same tx.
//
// Lines MUST be inserted in a single multi-row INSERT. Migration 000124 installs
// trg_journal_lines_balanced as AFTER INSERT FOR EACH STATEMENT; per-row Creates
// would each fire the trigger with only one line and fail with "unbalanced".
func PostBalancedJournal(tx *gorm.DB, entryType, externalRef, description string, lines []JournalLineSpec) error {
	if len(lines) < 2 {
		return fmt.Errorf("journal requires at least 2 lines")
	}
	var sum int64
	for _, ln := range lines {
		if ln.AmountLamports == 0 {
			return fmt.Errorf("journal line amount must be non-zero")
		}
		sum += ln.AmountLamports
	}
	if sum != 0 {
		return fmt.Errorf("journal unbalanced: sum=%d", sum)
	}
	var n int64
	if err := tx.Raw(`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='ledger_journals'`).Scan(&n).Error; err != nil {
		return fmt.Errorf("journal schema check: %w", err)
	}
	if n == 0 {
		// Soft-skip only outside staging/production (unit tests / pre-migration local).
		env := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
		switch env {
		case "production", "prod", "staging":
			return fmt.Errorf("ledger_journals table missing; run migration 000124+")
		default:
			return nil
		}
	}
	j := LedgerJournal{
		ExternalRef: externalRef,
		EntryType:   entryType,
		Description: description,
	}
	if err := tx.Create(&j).Error; err != nil {
		return err
	}
	now := time.Now().UTC()
	rows := make([]LedgerJournalLine, 0, len(lines))
	for _, ln := range lines {
		rows = append(rows, LedgerJournalLine{
			ID:             uuid.New(),
			JournalID:      j.ID,
			AccountCode:    ln.AccountCode,
			WalletID:       ln.WalletID,
			AmountLamports: ln.AmountLamports,
			CreatedAt:      now,
		})
	}
	// One statement so the statement-level balance trigger sees all lines together.
	if err := tx.Create(&rows).Error; err != nil {
		return err
	}
	return nil
}

// postUserCreditJournal: increase user liability funded from treasury cash.
// Dr 1000 treasury / Cr 2100 user liability
func postUserCreditJournal(tx *gorm.DB, walletID uuid.UUID, lamports int64, entryType, ref, desc string) error {
	wid := walletID
	return PostBalancedJournal(tx, entryType, ref, desc, []JournalLineSpec{
		{AccountCode: AccountTreasuryCash, AmountLamports: lamports},
		{AccountCode: AccountUserWalletLiability, WalletID: &wid, AmountLamports: -lamports},
	})
}

// postUserCreditJournalFromVault: liability funded from deposit vault cash.
// Dr 1001 deposit_vault_cash / Cr 2100 user liability
func postUserCreditJournalFromVault(tx *gorm.DB, walletID uuid.UUID, lamports int64, entryType, ref, desc string) error {
	wid := walletID
	return PostBalancedJournal(tx, entryType, ref, desc, []JournalLineSpec{
		{AccountCode: AccountDepositVaultCash, AmountLamports: lamports},
		{AccountCode: AccountUserWalletLiability, WalletID: &wid, AmountLamports: -lamports},
	})
}

// postUserDebitJournal: decrease user liability paying out of treasury.
// Dr 2100 user liability / Cr 1000 treasury
func postUserDebitJournal(tx *gorm.DB, walletID uuid.UUID, lamports int64, entryType, ref, desc string) error {
	wid := walletID
	return PostBalancedJournal(tx, entryType, ref, desc, []JournalLineSpec{
		{AccountCode: AccountUserWalletLiability, WalletID: &wid, AmountLamports: lamports},
		{AccountCode: AccountTreasuryCash, AmountLamports: -lamports},
	})
}

// postStakeJournal moves liability to escrow hold.
// Dr 2100 / Cr 2200
func postStakeJournal(tx *gorm.DB, walletID uuid.UUID, lamports int64, entryType, ref, desc string) error {
	wid := walletID
	return PostBalancedJournal(tx, entryType, ref, desc, []JournalLineSpec{
		{AccountCode: AccountUserWalletLiability, WalletID: &wid, AmountLamports: lamports},
		{AccountCode: AccountEscrowLiability, WalletID: &wid, AmountLamports: -lamports},
	})
}

// postUnstakeJournal reverses stake hold.
// Dr 2200 / Cr 2100
func postUnstakeJournal(tx *gorm.DB, walletID uuid.UUID, lamports int64, entryType, ref, desc string) error {
	wid := walletID
	return PostBalancedJournal(tx, entryType, ref, desc, []JournalLineSpec{
		{AccountCode: AccountEscrowLiability, WalletID: &wid, AmountLamports: lamports},
		{AccountCode: AccountUserWalletLiability, WalletID: &wid, AmountLamports: -lamports},
	})
}

// postP2PJournal transfers liability between two wallets.
// Dr 2100 sender / Cr 2100 recipient
func postP2PJournal(tx *gorm.DB, senderID, recipientID uuid.UUID, lamports int64, entryType, ref, desc string) error {
	s, r := senderID, recipientID
	return PostBalancedJournal(tx, entryType, ref, desc, []JournalLineSpec{
		{AccountCode: AccountUserWalletLiability, WalletID: &s, AmountLamports: lamports},
		{AccountCode: AccountUserWalletLiability, WalletID: &r, AmountLamports: -lamports},
	})
}

// PostUsageJournal: buyer pays, optional provider earn + platform fee.
// Dr 2100 buyer; Cr 2100 provider (net); Cr 4000 fee
func PostUsageJournal(tx *gorm.DB, buyerWalletID, providerWalletID uuid.UUID, buyerDebit, providerCredit, feeLamports int64, ref, desc string) error {
	if buyerDebit <= 0 {
		return nil
	}
	b := buyerWalletID
	lines := []JournalLineSpec{
		{AccountCode: AccountUserWalletLiability, WalletID: &b, AmountLamports: buyerDebit},
	}
	if providerCredit > 0 && providerWalletID != uuid.Nil {
		p := providerWalletID
		lines = append(lines, JournalLineSpec{AccountCode: AccountUserWalletLiability, WalletID: &p, AmountLamports: -providerCredit})
	}
	remaining := buyerDebit - providerCredit
	if feeLamports > 0 {
		lines = append(lines, JournalLineSpec{AccountCode: AccountPlatformRevenue, AmountLamports: -feeLamports})
		remaining -= feeLamports
	}
	if remaining != 0 {
		// Absorb residual into platform revenue so the journal stays balanced.
		lines = append(lines, JournalLineSpec{AccountCode: AccountPlatformRevenue, AmountLamports: -remaining})
	}
	return PostBalancedJournal(tx, TransactionUsage, ref, desc, lines)
}

// postUsageJournal kept as unexported alias for older call sites.
func postUsageJournal(tx *gorm.DB, buyerWalletID, providerWalletID uuid.UUID, buyerDebit, providerCredit, feeLamports int64, ref, desc string) error {
	return PostUsageJournal(tx, buyerWalletID, providerWalletID, buyerDebit, providerCredit, feeLamports, ref, desc)
}
