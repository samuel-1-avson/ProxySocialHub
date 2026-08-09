package ops

import (
	"context"
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/solana"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// RecreditDeposits credits stuck on-chain native deposits that failed ledger dual-write.
// specs format: "sig:lamports,sig:lamports" (lamports preferred from chain if they differ).
func RecreditDeposits(specs string, dryRun bool) error {
	return RecreditDepositsOpts(specs, dryRun, false)
}

// RecreditDepositsOpts adds trustCLI for RPC outages.
// When trustCLI is true, each spec must be "sig:lamports:sender" (already verified offline).
func RecreditDepositsOpts(specs string, dryRun, trustCLI bool) error {
	specs = strings.TrimSpace(specs)
	if specs == "" {
		return fmt.Errorf("empty deposit specs")
	}
	treasury := solana.GetTreasuryAddress()
	if treasury == "" && !trustCLI {
		return fmt.Errorf("SOLANA_TREASURY_ADDRESS not configured")
	}
	ctx := context.Background()
	ok, fail := 0, 0
	for _, part := range strings.Split(specs, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		sp, err := parseSpec(part)
		if err != nil {
			log.Printf("FAIL parse %q: %v", part, err)
			fail++
			continue
		}
		var runErr error
		for attempt := 1; attempt <= 5; attempt++ {
			runErr = recreditOne(ctx, treasury, sp, dryRun, trustCLI)
			if runErr == nil {
				break
			}
			msg := strings.ToLower(runErr.Error())
			if trustCLI || (!strings.Contains(msg, "rate limit") && !strings.Contains(msg, "429") && !strings.Contains(msg, "too many")) {
				break
			}
			sleep := time.Duration(attempt*5) * time.Second
			log.Printf("RETRY %s attempt=%d after %s: %v", sp.sig, attempt, sleep, runErr)
			time.Sleep(sleep)
		}
		if runErr != nil {
			log.Printf("FAIL %s: %v", sp.sig, runErr)
			fail++
			continue
		}
		log.Printf("OK %s (%.9f SOL)", sp.sig, float64(sp.lamports)/1e9)
		ok++
	}
	log.Printf("recredit done ok=%d fail=%d dry_run=%v trust=%v", ok, fail, dryRun, trustCLI)
	if fail > 0 {
		return fmt.Errorf("recredit failures: %d", fail)
	}
	return nil
}

type txSpec struct {
	sig      string
	lamports uint64
	sender   string
}

func parseSpec(v string) (txSpec, error) {
	parts := strings.Split(v, ":")
	if len(parts) < 2 || len(parts) > 3 {
		return txSpec{}, fmt.Errorf("expected SIG:LAMPORTS or SIG:LAMPORTS:SENDER")
	}
	lamports, err := strconv.ParseUint(strings.TrimSpace(parts[1]), 10, 64)
	if err != nil {
		return txSpec{}, err
	}
	sp := txSpec{sig: strings.TrimSpace(parts[0]), lamports: lamports}
	if len(parts) == 3 {
		sp.sender = strings.TrimSpace(parts[2])
	}
	return sp, nil
}

func recreditOne(ctx context.Context, treasury string, sp txSpec, dryRun, trustCLI bool) error {
	var existing models.PendingTransaction
	if err := db.DB.Where("reference = ?", sp.sig).First(&existing).Error; err == nil {
		return fmt.Errorf("already credited (status=%s)", existing.Status)
	}

	var (
		solAmount float64
		sender    string
	)
	if trustCLI {
		if sp.lamports == 0 {
			return fmt.Errorf("trust mode requires lamports")
		}
		if sp.sender == "" {
			return fmt.Errorf("trust mode requires SIG:LAMPORTS:SENDER")
		}
		solAmount = float64(sp.lamports) / 1e9
		sender = sp.sender
	} else {
		txResult, err := solana.VerifyTransaction(ctx, sp.sig)
		if err != nil {
			return fmt.Errorf("verify tx: %w", err)
		}
		valid, receivedSOL, err := solana.VerifyTransferAmount(txResult, treasury, 0)
		if err != nil || !valid {
			return fmt.Errorf("tx does not credit treasury: valid=%v err=%v", valid, err)
		}
		receivedLamports := models.SOLToLamports(receivedSOL)
		if sp.lamports > 0 && receivedLamports != sp.lamports {
			log.Printf("WARN %s: CLI lamports=%d on-chain=%d — using on-chain", sp.sig, sp.lamports, receivedLamports)
		}
		solAmount = receivedSOL
		sender, err = solana.GetTransactionSender(txResult)
		if err != nil {
			return fmt.Errorf("sender: %w", err)
		}
	}

	userID, err := resolveUser(sender)
	if err != nil {
		return err
	}

	if dryRun {
		log.Printf("DRY user=%s sender=%s amount=%.9f", userID, sender, solAmount)
		return nil
	}

	return db.DB.Transaction(func(tx *gorm.DB) error {
		var wallet models.Wallet
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", userID).First(&wallet).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				wallet = models.Wallet{UserID: userID}
				if err := tx.Create(&wallet).Error; err != nil {
					return err
				}
			} else {
				return err
			}
		}

		maxSingle := models.MaxSingleDepositSOL()
		if solAmount > maxSingle {
			return fmt.Errorf("exceeds single deposit cap (%.6f > %.6f)", solAmount, maxSingle)
		}
		used, err := models.SumDepositsSince(tx, wallet.ID, time.Now().UTC().Add(-24*time.Hour))
		if err != nil {
			return err
		}
		maxDaily := models.MaxDailyDepositSOL()
		if used+solAmount > maxDaily {
			return fmt.Errorf("exceeds daily deposit cap (used=%.6f + %.6f > %.6f)", used, solAmount, maxDaily)
		}

		if err := models.CreditWalletLockedOpts(tx, &wallet, solAmount, "deposit_auto", sp.sig,
			fmt.Sprintf("Auto-Deposit recovery: %.6f SOL", solAmount),
			models.LedgerOpts{TxHash: sp.sig},
		); err != nil {
			return err
		}

		pending := models.PendingTransaction{
			ID:             uuid.New(),
			UserID:         userID,
			Reference:      sp.sig,
			IdempotencyKey: sp.sig,
			Type:           "crypto_deposit",
			Amount:         solAmount,
			Currency:       "SOL",
			Provider:       "blockchain_auto",
			Status:         "completed",
			ExternalRef:    sp.sig,
		}
		return tx.Create(&pending).Error
	})
}

func resolveUser(sender string) (uuid.UUID, error) {
	var linked models.LinkedWallet
	if err := db.DB.Where("address = ?", sender).First(&linked).Error; err == nil {
		return linked.UserID, nil
	}
	var user models.User
	if err := db.DB.Where("wallet_address = ?", sender).First(&user).Error; err == nil {
		return user.ID, nil
	}
	return uuid.Nil, fmt.Errorf("no user linked to sender %s", sender)
}
