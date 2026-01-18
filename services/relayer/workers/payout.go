package workers

import (
	"log"
	"math/big"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/proxyhubb/relayer/db"
	"github.com/proxyhubb/relayer/eth"
)

type PayoutWorker struct {
	ethClient *eth.Client
}

func NewPayoutWorker(client *eth.Client) *PayoutWorker {
	return &PayoutWorker{
		ethClient: client,
	}
}

// ProcessPayouts checks for pending earnings and triggers blockchain transactions
func (w *PayoutWorker) ProcessPayouts() error {
	log.Println("Scanning for pending payouts...")

	// 1. Get Candidates (> 10 GHS threshold)
	candidates, err := db.GetCandidatesForPayout(10.0)
	if err != nil {
		return err
	}

	if len(candidates) == 0 {
		log.Println("No pending payouts found.")
		return nil
	}

	log.Printf("Found %d candidates for payout.", len(candidates))

	// Mock Treasury Address (The Relayer itself)
	treasuryAddr := w.ethClient.Address()
	oracleKey := w.ethClient.PrivateKey()

	// Fetch Contract Price Per GB (to reverse calculate bytes)
	pricePerGB, err := w.ethClient.GetPricePerGB()
	if err != nil {
		log.Printf("Failed to fetch price: %v", err)
		return err
	}

	for _, user := range candidates {
		if user.WalletAddress == nil {
			continue
		}
		providerAddr := common.HexToAddress(*user.WalletAddress)
		amountGHS := user.Wallet.Balance

		log.Printf("Processing payout for %s: %.2f GHS -> %s", user.Email, amountGHS, providerAddr.Hex())

		// Conversion: Assume 1 GHS = 0.0001 ETH (Mock Exchange Rate)
		// Target ETH Wei = amountGHS * 1e14
		ethWei := new(big.Int).SetInt64(int64(amountGHS * 1e14))

		// Calculate bytesUsed to match this ETH amount based on contract price
		// Cost = (bytes * price) / 1024^3
		// bytes = (Cost * 1024^3) / price
		gigabyte := new(big.Int).SetInt64(1024 * 1024 * 1024)
		bytesUsed := new(big.Int).Mul(ethWei, gigabyte)
		bytesUsed.Div(bytesUsed, pricePerGB)

		// Nonce: Unix Timestamp (Simple unique nonce for now)
		nonce := big.NewInt(time.Now().UnixNano())

		// 2. Sign Claim (Oracle Signature)
		sig, err := eth.SignClaim(oracleKey, treasuryAddr, providerAddr, bytesUsed, nonce)
		if err != nil {
			log.Printf("Failed to sign claim: %v", err)
			continue
		}

		// 3. Submit Claim on Blockchain
		txClaim, err := w.ethClient.ClaimEarningsFor(treasuryAddr, providerAddr, bytesUsed, nonce, sig)
		if err != nil {
			log.Printf("Blockchain Claim failed: %v", err)
			continue
		}
		log.Printf("Claim TX sent: %s", txClaim)

		// Wait for confirmation? For now, we proceed optimistically or wait a bit.
		time.Sleep(2 * time.Second)

		// 4. Trigger Withdrawal
		txWithdraw, err := w.ethClient.WithdrawEarningsFor(providerAddr)
		if err != nil {
			log.Printf("Blockchain Withdraw failed: %v", err)
			continue
		}
		log.Printf("Withdraw TX sent: %s", txWithdraw)

		// 5. Update DB
		if err := db.RecordPayout(user.ID, amountGHS, txWithdraw); err != nil {
			log.Printf("Failed to update DB ledger: %v", err)
		} else {
			log.Printf("Payout complete for %s", user.Email)
		}
	}

	return nil
}
