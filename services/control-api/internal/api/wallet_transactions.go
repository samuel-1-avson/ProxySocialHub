package api

import (
	"encoding/base64"
	"encoding/json"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// W-21: server-side keyset pagination for wallet history. The old
// frontend fetched one fixed page from GET /wallet and sliced it
// client-side, so history silently truncated at 50 entries.

type txCursor struct {
	CreatedAt time.Time `json:"t"`
	ID        string    `json:"i"`
}

func encodeTxCursor(t time.Time, id string) string {
	raw, _ := json.Marshal(txCursor{CreatedAt: t, ID: id})
	return base64.RawURLEncoding.EncodeToString(raw)
}

func decodeTxCursor(s string) (txCursor, bool) {
	if s == "" {
		return txCursor{}, false
	}
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return txCursor{}, false
	}
	var cur txCursor
	if err := json.Unmarshal(raw, &cur); err != nil {
		return txCursor{}, false
	}
	return cur, true
}

func signedLamports(amountSOL float64) int64 {
	if amountSOL < 0 {
		return -int64(models.SOLToLamports(-amountSOL))
	}
	return int64(models.SOLToLamports(amountSOL))
}

// fetchWalletTransactions merges settled ledger entries and payment
// attempts in one keyset-paginated, globally ordered page.
func fetchWalletTransactions(walletID uuid.UUID, userID uuid.UUID, limit int, cursorStr string) ([]TransactionDTO, string) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	cur, hasCursor := decodeTxCursor(cursorStr)

	ledgerQ := db.DB.Where("wallet_id = ?", walletID)
	pendingQ := db.DB.Where("user_id = ?", userID.String())
	if hasCursor {
		cond := "(created_at < ? OR (created_at = ? AND id::text < ?))"
		ledgerQ = ledgerQ.Where(cond, cur.CreatedAt, cur.CreatedAt, cur.ID)
		pendingQ = pendingQ.Where(cond, cur.CreatedAt, cur.CreatedAt, cur.ID)
	}

	var ledger []models.WalletLedgerEntry
	_ = ledgerQ.Order("created_at DESC, id DESC").Limit(limit + 1).Find(&ledger).Error
	var attempts []models.PendingTransaction
	_ = pendingQ.Order("created_at DESC, id DESC").Limit(limit + 1).Find(&attempts).Error

	transactions := make([]TransactionDTO, 0, len(ledger)+len(attempts))
	ledgerRefs := make(map[string]bool, len(ledger))
	for _, l := range ledger {
		ledgerRefs[l.ReferenceID] = true
		dto := TransactionDTO{
			ID:             l.ID.String(),
			Type:           l.Type,
			Amount:         l.Amount,
			AmountLamports: signedLamports(l.Amount),
			Description:    ledgerEntryDescription(l),
			Status:         ledgerEntryStatus(l),
			CreatedAt:      l.CreatedAt,
		}
		if l.TxHash != "" {
			dto.TxHash = l.TxHash
			dto.SolscanURL = SolscanTxURL(l.TxHash)
		} else if isLikelySolanaSignature(l.ReferenceID) {
			dto.TxHash = l.ReferenceID
			dto.SolscanURL = SolscanTxURL(l.ReferenceID)
		}
		transactions = append(transactions, dto)
	}
	for _, p := range attempts {
		if ledgerRefs[p.Reference] {
			continue
		}
		status := p.Status
		if status == "processing" {
			status = "pending"
		}
		desc := p.Type + " (" + p.Provider + ")"
		if p.Type == "deposit" {
			desc = "Deposit via " + p.Provider
		} else if p.Type == "withdrawal" {
			desc = "Withdrawal to " + p.Provider
		}
		displayAmount := p.Amount
		if p.Type == "withdrawal" {
			displayAmount = -p.Amount
		}
		transactions = append(transactions, TransactionDTO{
			ID:             p.ID.String(),
			Type:           p.Type,
			Amount:         displayAmount,
			AmountLamports: signedLamports(displayAmount),
			Description:    desc,
			Status:         status,
			CreatedAt:      p.CreatedAt,
		})
	}

	sort.Slice(transactions, func(i, j int) bool {
		if !transactions[i].CreatedAt.Equal(transactions[j].CreatedAt) {
			return transactions[i].CreatedAt.After(transactions[j].CreatedAt)
		}
		return transactions[i].ID > transactions[j].ID
	})

	next := ""
	if len(transactions) > limit {
		transactions = transactions[:limit]
		last := transactions[len(transactions)-1]
		next = encodeTxCursor(last.CreatedAt, last.ID)
	}
	return transactions, next
}
