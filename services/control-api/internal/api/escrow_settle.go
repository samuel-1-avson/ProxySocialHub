package api

import (
	"context"
	"fmt"
	"strings"

	sol "github.com/gagliardetto/solana-go"
	"github.com/proxyhubb/control-api/internal/models"
	solanaClient "github.com/proxyhubb/control-api/internal/solana"
)

const escrowSeedKindMultisig = "multisig"

// orderUsesMultisigSettle reports whether the order's on-chain escrow must be
// settled via SettleEscrowMultiSig (BC-06 escrow_multisig PDAs).
func orderUsesMultisigSettle(order *models.Order) bool {
	if order == nil {
		return false
	}
	return strings.EqualFold(strings.TrimSpace(order.EscrowSeedKind), escrowSeedKindMultisig)
}

// SettleOrderEscrow settles a marketplace order escrow on-chain using the
// order's bandwidth limit as usage (full release). For metered settle, use
// SettleOrderEscrowUsage.
func SettleOrderEscrow(ctx context.Context, source string, order *models.Order) (string, error) {
	return SettleOrderEscrowUsage(ctx, source, order, 0)
}

// SettleOrderEscrowUsage settles with an explicit bandwidth-used figure.
// bandwidthUsedGB == 0 falls back to order.BandwidthLimitGB / BandwidthGB.
func SettleOrderEscrowUsage(ctx context.Context, source string, order *models.Order, bandwidthUsedGB uint64) (string, error) {
	if order == nil {
		return "", fmt.Errorf("order is nil")
	}
	if order.EscrowPDA == "" || order.SellerWallet == "" || order.BuyerWallet == "" {
		return "", fmt.Errorf("order missing escrow_pda or wallets")
	}

	escrowPDA, err := sol.PublicKeyFromBase58(order.EscrowPDA)
	if err != nil {
		return "", fmt.Errorf("escrow_pda: %w", err)
	}
	sellerKey, err := sol.PublicKeyFromBase58(order.SellerWallet)
	if err != nil {
		return "", fmt.Errorf("seller_wallet: %w", err)
	}
	buyerKey, err := sol.PublicKeyFromBase58(order.BuyerWallet)
	if err != nil {
		return "", fmt.Errorf("buyer_wallet: %w", err)
	}

	used := bandwidthUsedGB
	if used == 0 {
		used = order.BandwidthLimitGB
	}
	if used == 0 {
		used = uint64(order.BandwidthGB)
	}

	params := solanaClient.SettleEscrowParams{
		EscrowPDA:       escrowPDA,
		Seller:          sellerKey,
		Buyer:           buyerKey,
		BandwidthUsedGB: used,
	}

	if orderUsesMultisigSettle(order) {
		ms := solanaClient.GetMultiSigOracle()
		if ms == nil {
			return "", fmt.Errorf("multisig oracle client not available")
		}
		return ms.SettleEscrowMultiSigLocal(ctx, params)
	}

	oracle := solanaClient.GetOracleClient()
	if oracle == nil {
		return "", fmt.Errorf("oracle client not available")
	}
	return oracle.SettleEscrow(ctx, source, params)
}
