package services

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/core/domain"
	"github.com/proxyhubb/control-api/internal/core/ports"
)

type readTestRepo struct {
	fakeMarketplaceRepo
	saved bool
}

func (r *readTestRepo) GetListingDetail(context.Context, uuid.UUID) (*domain.ListingEntity, *domain.SellerPublicProfile, error) {
	if r.listing.ID == uuid.Nil {
		return nil, nil, domain.ErrListingNotFound
	}
	return &r.listing, nil, nil
}

func (r *readTestRepo) IsListingSaved(context.Context, uuid.UUID, uuid.UUID) (bool, error) {
	return r.saved, nil
}

func TestGetListingForViewer_PendingReviewHiddenFromPublic(t *testing.T) {
	sellerID := uuid.New()
	listingID := uuid.New()
	repo := &readTestRepo{
		fakeMarketplaceRepo: fakeMarketplaceRepo{
			listing: domain.ListingEntity{
				ID:       listingID,
				SellerID: sellerID,
				Status:   domain.ListingPendingReview,
			},
		},
	}
	svc := NewMarketplaceService(repo)

	_, err := svc.GetListingForViewer(context.Background(), listingID, ports.ListingViewer{})
	if !errors.Is(err, domain.ErrListingNotFound) {
		t.Fatalf("expected ErrListingNotFound, got %v", err)
	}
}

func TestGetListingForViewer_PendingReviewVisibleToSeller(t *testing.T) {
	sellerID := uuid.New()
	listingID := uuid.New()
	repo := &readTestRepo{
		fakeMarketplaceRepo: fakeMarketplaceRepo{
			listing: domain.ListingEntity{
				ID:       listingID,
				SellerID: sellerID,
				Status:   domain.ListingPendingReview,
			},
		},
	}
	svc := NewMarketplaceService(repo)

	detail, err := svc.GetListingForViewer(context.Background(), listingID, ports.ListingViewer{UserID: &sellerID})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if detail.Listing.Status != domain.ListingPendingReview {
		t.Fatalf("expected pending_review, got %s", detail.Listing.Status)
	}
}

func TestGetListingForViewer_ActiveListingMarksSaved(t *testing.T) {
	buyerID := uuid.New()
	listingID := uuid.New()
	repo := &readTestRepo{
		fakeMarketplaceRepo: fakeMarketplaceRepo{
			listing: domain.ListingEntity{
				ID:     listingID,
				Status: domain.ListingActive,
			},
		},
		saved: true,
	}
	svc := NewMarketplaceService(repo)

	detail, err := svc.GetListingForViewer(context.Background(), listingID, ports.ListingViewer{UserID: &buyerID})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !detail.IsSaved {
		t.Fatal("expected listing to be marked saved")
	}
}
