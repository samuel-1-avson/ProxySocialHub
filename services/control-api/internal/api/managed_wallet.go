package api

import (
	"context"
	"strings"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/custody"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/solana"
)

// rentExemptMinLamports is the rent-exempt minimum for a plain (0-data) system
// account. A transfer that leaves a 0-lamport account below it fails on chain.
const rentExemptMinLamports uint64 = 890_880

// managedWalletSeedLamports is what the float sends a newly approved managed-wallet
// provider so small escrow payouts into an empty wallet don't fail the rent check.
const managedWalletSeedLamports uint64 = 1_000_000

// managedWalletAddress returns the user's server-held wallet address when it is
// also their payout wallet (profiles.wallet_address). Google sign-in users have one.
func managedWalletAddress(userID uuid.UUID, profileWallet *string) (string, bool) {
	if db.DB == nil || userID == uuid.Nil {
		return "", false
	}
	row, err := custody.FindWallet(db.DB, userID)
	if err != nil {
		return "", false
	}
	if profileWallet != nil && strings.TrimSpace(*profileWallet) != row.Address {
		return "", false
	}
	return row.Address, true
}

// nodePayoutAddress picks who a session escrow pays for a node. Managed-wallet
// owners are paid to their ProxyHubb wallet: they cannot use the device key in
// provider.toml. Everyone else keeps the node hotkey.
func nodePayoutAddress(ownerID uuid.UUID, hotkey string) string {
	if addr, ok := managedWalletAddress(ownerID, nil); ok {
		return addr
	}
	return hotkey
}

// seedManagedWalletRent tops a managed wallet up to the rent-exempt minimum from the
// float. Best effort: approval never depends on it. A package var for tests.
var seedManagedWalletRent = func(userID uuid.UUID, address string) {
	oracle := solana.GetOracle()
	if oracle == nil {
		return
	}
	pub, err := sol.PublicKeyFromBase58(address)
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	bal, err := oracle.GetBalance(ctx, pub)
	if err != nil || bal >= rentExemptMinLamports {
		return
	}
	sig, err := oracle.SendSOL(ctx, pub, managedWalletSeedLamports)
	if err != nil {
		logging.Warn().Err(err).Str("user_id", userID.String()).Msg("managed wallet: rent seed failed")
		return
	}
	logging.Info().Str("user_id", userID.String()).Str("tx", sig).Msg("managed wallet: rent seed sent")
}

// providerApprovedWithManagedWallet runs follow-up work for a managed-wallet provider
// approval (rent seed). Safe to call more than once.
func providerApprovedWithManagedWallet(user *models.User, decision ProviderAutoApprovalResult) {
	if decision.Status != "approved" || decision.ReasonCode != "managed_wallet" || user == nil {
		return
	}
	if addr, ok := managedWalletAddress(user.ID, user.WalletAddress); ok {
		go seedManagedWalletRent(user.ID, addr)
	}
}
