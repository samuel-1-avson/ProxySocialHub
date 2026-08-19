package api

import (
	"context"
	"fmt"
	"strings"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/decentralization"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	solanaClient "github.com/proxyhubb/control-api/internal/solana"
)

// maybeRegisterListingCommitmentAsync best-effort anchors a verified offer hash
// on-chain when PROXYHUB_LISTING_COMMITMENT is observe|enforce (Wave 5.C.5).
func maybeRegisterListingCommitmentAsync(listingID uuid.UUID, offerHashHex, signerOrHotkey string) {
	if !decentralization.ListingCommitmentEnabled() {
		return
	}
	offerHashHex = strings.TrimSpace(offerHashHex)
	signerOrHotkey = strings.TrimSpace(signerOrHotkey)
	if offerHashHex == "" || signerOrHotkey == "" || listingID == uuid.Nil {
		return
	}
	go registerListingCommitmentAsync(listingID, offerHashHex, signerOrHotkey)
}

func registerListingCommitmentAsync(listingID uuid.UUID, offerHashHex, providerHotkey string) {
	defer func() {
		if rec := recover(); rec != nil {
			logging.Error(fmt.Errorf("%v", rec)).
				Str("listing_id", listingID.String()).
				Msg("listing commitment: panic (non-fatal)")
		}
	}()
	oracle := solanaClient.GetOracleClient()
	if oracle == nil {
		logging.Warn().Str("listing_id", listingID.String()).Msg("listing commitment: oracle unavailable")
		return
	}
	logging.Info().Str("listing_id", listingID.String()).Msg("listing commitment: register started")
	offerHash, err := solanaClient.ParseOfferHashHex(offerHashHex)
	if err != nil {
		logging.Warn().Err(err).Str("listing_id", listingID.String()).Msg("listing commitment: bad offer hash")
		return
	}
	provider, err := sol.PublicKeyFromBase58(providerHotkey)
	if err != nil {
		logging.Warn().Err(err).Str("listing_id", listingID.String()).Msg("listing commitment: bad provider pubkey")
		return
	}
	pda, _, err := oracle.GetListingCommitmentPDA(provider, offerHash)
	if err != nil {
		logging.Warn().Err(err).Msg("listing commitment: PDA derive failed")
		return
	}

	params := solanaClient.RegisterListingCommitmentParams{
		Provider:  provider,
		OfferHash: offerHash,
		ListingID: listingID,
	}
	var sig string
	for attempt := 1; attempt <= 8; attempt++ {
		sig, err = oracle.RegisterListingCommitmentOnChain(context.Background(), params)
		if err == nil {
			break
		}
		lower := strings.ToLower(err.Error())
		if strings.Contains(lower, "already in use") || strings.Contains(lower, "already been initialized") {
			markListingCommitmentMirrored(listingID, pda.String(), "existing")
			return
		}
		transient := strings.Contains(lower, "429") ||
			strings.Contains(lower, "too many requests") ||
			strings.Contains(lower, "rate limit") ||
			strings.Contains(lower, "timeout")
		if !transient || attempt == 8 {
			logging.Warn().Err(err).Int("attempt", attempt).Str("listing_id", listingID.String()).Msg("listing commitment: register failed (non-fatal)")
			return
		}
		logging.Warn().Err(err).Int("attempt", attempt).Str("listing_id", listingID.String()).Msg("listing commitment: register retry")
		time.Sleep(time.Duration(attempt) * 3 * time.Second)
	}
	markListingCommitmentMirrored(listingID, pda.String(), sig)
	logging.Info().
		Str("listing_id", listingID.String()).
		Str("pda", pda.String()).
		Str("sig", sig).
		Msg("listing commitment registered on-chain")
}

func markListingCommitmentMirrored(listingID uuid.UUID, pda, tx string) {
	if db.DB == nil {
		return
	}
	now := time.Now().UTC()
	_ = db.DB.Model(&models.ProxyListing{}).Where("id = ?", listingID).Updates(map[string]interface{}{
		"listing_commitment_pda":      pda,
		"listing_commitment_on_chain": true,
		"listing_commitment_tx":       tx,
		"listing_commitment_at":       now,
	}).Error
}
