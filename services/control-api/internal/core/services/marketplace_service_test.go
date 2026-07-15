package services

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/core/domain"
)

type fakeMarketplaceRepo struct {
	listing      domain.ListingEntity
	saved        bool
	unsaved      bool
	deleted      bool
	updateCalled bool
}

func (f *fakeMarketplaceRepo) GetListings(context.Context, map[string]interface{}) ([]domain.ListingEntity, int64, error) {
	return nil, 0, nil
}

func (f *fakeMarketplaceRepo) GetListingByID(context.Context, uuid.UUID) (*domain.ListingEntity, error) {
	if f.listing.ID == uuid.Nil {
		return nil, domain.ErrListingNotFound
	}
	return &f.listing, nil
}

func (f *fakeMarketplaceRepo) GetListingDetail(context.Context, uuid.UUID) (*domain.ListingEntity, *domain.SellerPublicProfile, error) {
	if f.listing.ID == uuid.Nil {
		return nil, nil, domain.ErrListingNotFound
	}
	return &f.listing, nil, nil
}

func (f *fakeMarketplaceRepo) IncrementListingViews(context.Context, uuid.UUID) error {
	return nil
}

func (f *fakeMarketplaceRepo) IsListingSaved(context.Context, uuid.UUID, uuid.UUID) (bool, error) {
	return false, nil
}

func (f *fakeMarketplaceRepo) SearchListings(context.Context, string, int) ([]domain.ListingEntity, error) {
	return nil, nil
}

func (f *fakeMarketplaceRepo) GetFeaturedListings(context.Context, int) ([]domain.ListingEntity, error) {
	return nil, nil
}

func (f *fakeMarketplaceRepo) GetSellerListings(context.Context, uuid.UUID, int, int) ([]domain.ListingEntity, int64, error) {
	return nil, 0, nil
}

func (f *fakeMarketplaceRepo) GetSavedListings(context.Context, uuid.UUID, int, int) ([]domain.SavedListingEntry, int64, error) {
	return nil, 0, nil
}

func (f *fakeMarketplaceRepo) CreateListing(context.Context, *domain.ListingEntity) error {
	return nil
}

func (f *fakeMarketplaceRepo) UpdateListing(_ context.Context, _ uuid.UUID, updates domain.ListingUpdate) (*domain.ListingEntity, error) {
	f.updateCalled = true
	if updates.Status != nil {
		f.listing.Status = *updates.Status
	}
	if updates.Title != nil {
		f.listing.Title = *updates.Title
	}
	return &f.listing, nil
}

func (f *fakeMarketplaceRepo) DeleteListing(context.Context, uuid.UUID) error {
	f.deleted = true
	f.listing.Status = domain.ListingDeleted
	return nil
}

func (f *fakeMarketplaceRepo) SaveListing(context.Context, uuid.UUID, uuid.UUID) error {
	f.saved = true
	return nil
}

func (f *fakeMarketplaceRepo) UnsaveListing(context.Context, uuid.UUID, uuid.UUID) error {
	f.unsaved = true
	return nil
}

func (f *fakeMarketplaceRepo) GetNodeByID(context.Context, uuid.UUID) (*domain.NodeEntity, error) {
	return nil, nil
}

func (f *fakeMarketplaceRepo) UpdateNodeStatus(context.Context, uuid.UUID, bool, int) error {
	return nil
}

func (f *fakeMarketplaceRepo) RecordUptimeCheck(context.Context, uuid.UUID, bool, int) error {
	return nil
}

func (f *fakeMarketplaceRepo) GetLast24HoursChecks(context.Context, uuid.UUID) ([]domain.UptimeCheck, error) {
	return nil, nil
}

func (f *fakeMarketplaceRepo) UpdateQualityScore(context.Context, uuid.UUID, float64) error {
	return nil
}

func TestMarketplaceService_UpdateListingBoundary(t *testing.T) {
	sellerID := uuid.New()
	listingID := uuid.New()
	repo := &fakeMarketplaceRepo{
		listing: domain.ListingEntity{
			ID:       listingID,
			SellerID: sellerID,
			Status:   domain.ListingActive,
			Title:    "Original",
		},
	}
	svc := NewMarketplaceService(repo)

	title := "Updated"
	status := domain.ListingPaused
	updated, err := svc.UpdateListing(context.Background(), sellerID, listingID, domain.ListingUpdate{
		Title:  &title,
		Status: &status,
	})
	if err != nil {
		t.Fatalf("expected update to succeed, got %v", err)
	}
	if !repo.updateCalled {
		t.Fatal("expected repository update to be called")
	}
	if updated.Title != title || updated.Status != status {
		t.Fatalf("expected updated title/status, got %#v", updated)
	}
}

func TestMarketplaceService_UpdateListingRejectsWrongSeller(t *testing.T) {
	repo := &fakeMarketplaceRepo{
		listing: domain.ListingEntity{
			ID:       uuid.New(),
			SellerID: uuid.New(),
			Status:   domain.ListingActive,
		},
	}
	svc := NewMarketplaceService(repo)

	title := "Blocked"
	_, err := svc.UpdateListing(context.Background(), uuid.New(), repo.listing.ID, domain.ListingUpdate{Title: &title})
	if !errors.Is(err, domain.ErrListingForbidden) {
		t.Fatalf("expected forbidden error, got %v", err)
	}
	if repo.updateCalled {
		t.Fatal("repository update should not be called for wrong seller")
	}
}

func TestMarketplaceService_DeleteListingRejectsTerminalState(t *testing.T) {
	sellerID := uuid.New()
	repo := &fakeMarketplaceRepo{
		listing: domain.ListingEntity{
			ID:       uuid.New(),
			SellerID: sellerID,
			Status:   domain.ListingDeleted,
		},
	}
	svc := NewMarketplaceService(repo)

	if err := svc.DeleteListing(context.Background(), sellerID, repo.listing.ID); err == nil {
		t.Fatal("expected invalid transition error")
	}
	if repo.deleted {
		t.Fatal("repository delete should not be called for terminal listing")
	}
}

func TestMarketplaceService_SaveListingRequiresActiveListing(t *testing.T) {
	repo := &fakeMarketplaceRepo{
		listing: domain.ListingEntity{
			ID:       uuid.New(),
			SellerID: uuid.New(),
			Status:   domain.ListingPaused,
		},
	}
	svc := NewMarketplaceService(repo)

	err := svc.SaveListing(context.Background(), uuid.New(), repo.listing.ID)
	if !errors.Is(err, domain.ErrListingUnavailable) {
		t.Fatalf("expected unavailable error, got %v", err)
	}
	if repo.saved {
		t.Fatal("repository save should not be called for unavailable listing")
	}
}

func TestMarketplaceService_UnsaveListingDelegates(t *testing.T) {
	repo := &fakeMarketplaceRepo{
		listing: domain.ListingEntity{
			ID:       uuid.New(),
			SellerID: uuid.New(),
			Status:   domain.ListingActive,
		},
	}
	svc := NewMarketplaceService(repo)

	if err := svc.UnsaveListing(context.Background(), uuid.New(), repo.listing.ID); err != nil {
		t.Fatalf("expected unsave to succeed, got %v", err)
	}
	if !repo.unsaved {
		t.Fatal("expected repository unsave to be called")
	}
}
