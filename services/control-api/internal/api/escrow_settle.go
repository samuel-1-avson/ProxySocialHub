package api

import (
	"context"
	"fmt"
	"strings"

	sol "github.com/gagliardetto/solana-go"
	"github.com/proxyhubb/control-api/internal/logging"
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

func orderPurchasedGiB(order *models.Order) float64 {
	if order == nil {
		return 0
	}
	if order.BandwidthGB > 0 {
		return order.BandwidthGB
	}
	if order.BandwidthLimitGB > 0 && order.BandwidthLimitGB < solanaClient.EscrowUnitsPerGiB {
		return float64(order.BandwidthLimitGB)
	}
	if order.BandwidthLimitGB >= solanaClient.EscrowUnitsPerGiB {
		return float64(order.BandwidthLimitGB) / float64(solanaClient.EscrowUnitsPerGiB)
	}
	return 0
}

func resolveChainBandwidthLimit(ctx context.Context, order *models.Order) uint64 {
	fallback := solanaClient.LimitUnitsFromGiB(orderPurchasedGiB(order))
	if fallback == 0 {
		fallback = solanaClient.EscrowUnitsPerGiB
	}
	if order == nil || order.EscrowPDA == "" {
		return fallback
	}
	oracle := solanaClient.GetOracleClient()
	if oracle == nil {
		return fallback
	}
	pda, err := sol.PublicKeyFromBase58(order.EscrowPDA)
	if err != nil {
		return fallback
	}
	escrow, err := oracle.FetchEscrow(ctx, pda)
	if err != nil || escrow == nil || escrow.BandwidthLimitGB == 0 {
		return fallback
	}
	return escrow.BandwidthLimitGB
}

func chainUsedUnitsFromBytes(ctx context.Context, order *models.Order, usedBytes int64) uint64 {
	chainLimit := resolveChainBandwidthLimit(ctx, order)
	purchased := solanaClient.PurchasedBytes(orderPurchasedGiB(order))
	units := solanaClient.ScaleUsedToLimit(usedBytes, purchased, chainLimit)
	if solanaClient.ChainLimitLooksLikeWholeGiB(chainLimit) && usedBytes > 0 && units == 0 {
		logging.Warn().
			Str("order_id", order.ID.String()).
			Str("escrow_pda", order.EscrowPDA).
			Uint64("chain_limit", chainLimit).
			Int64("used_bytes", usedBytes).
			Msg("legacy integer-GiB escrow: sub-GiB usage floors to 0 on-chain units")
	}
	return units
}

// SettleOrderEscrow settles a marketplace order escrow on-chain using the
// full purchased bandwidth (seller takes the lock). For metered settle, use
// SettleOrderEscrowConsumedBytes.
func SettleOrderEscrow(ctx context.Context, source string, order *models.Order) (string, error) {
	return settleOrderEscrowUnits(ctx, source, order, resolveChainBandwidthLimit(ctx, order))
}

// SettleOrderEscrowConsumedBytes settles proportionally to bytes consumed.
// usedBytes == 0 pays the seller nothing (buyer refund of the lock).
func SettleOrderEscrowConsumedBytes(ctx context.Context, source string, order *models.Order, usedBytes int64) (string, error) {
	return settleOrderEscrowUnits(ctx, source, order, chainUsedUnitsFromBytes(ctx, order, usedBytes))
}

// SettleOrderEscrowUsage settles with an explicit on-chain used-units figure
// (micro-GiB after the integer-GiB fix). usedUnits == 0 is a full buyer refund.
func SettleOrderEscrowUsage(ctx context.Context, source string, order *models.Order, usedUnits uint64) (string, error) {
	return settleOrderEscrowUnits(ctx, source, order, usedUnits)
}

func settleOrderEscrowUnits(ctx context.Context, source string, order *models.Order, usedUnits uint64) (string, error) {
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

	params := solanaClient.SettleEscrowParams{
		EscrowPDA:       escrowPDA,
		Seller:          sellerKey,
		Buyer:           buyerKey,
		BandwidthUsedGB: usedUnits,
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
