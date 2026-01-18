package db

import (
	"log"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
)

func SeedAll() {
	if DB == nil {
		log.Println("DB not initialized, skipping seeds")
		return
	}

	seedUsers()
	seedListings()
}

func seedUsers() {

	users := []models.User{
		{
			Email:     "admin@proxyhub.com",
			Role:      "admin",
			Status:    models.UserStatusActive,
			TrustTier: models.TrustTierPremium,
		},
		{
			Email:       "provider@proxyhub.com",
			Role:        "provider",
			Status:      models.UserStatusActive,
			TrustTier:   models.TrustTierVerified,
			DisplayName: stringPtr("Best Proxies Ltd"),
			Username:    stringPtr("bestprovider"),
		},
		{
			Email:       "user@proxyhub.com",
			Role:        "user",
			Status:      models.UserStatusActive,
			TrustTier:   models.TrustTierNew,
			DisplayName: stringPtr("Regular Joe"),
			Username:    stringPtr("joe"),
		},
	}

	for _, u := range users {
		var existing models.User
		if err := DB.Where("email = ?", u.Email).First(&existing).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				if err := DB.Create(&u).Error; err != nil {
					log.Printf("Failed to seed user %s: %v", u.Email, err)
				} else {
					log.Printf("Seeded user: %s", u.Email)
				}
			} else {
				log.Printf("Error checking user %s: %v", u.Email, err)
			}
		} else {
			log.Printf("User %s already exists", u.Email)
		}
	}
}

func seedListings() {
	var provider models.User
	if err := DB.Where("email = ?", "provider@proxyhub.com").First(&provider).Error; err != nil {
		log.Println("Provider user not found, skipping listings seed")
		return
	}

	listings := []models.ProxyListing{
		{
			SellerID:             provider.ID,
			Title:                "Premium Residential Proxies (US)",
			Description:          "High speed residential IPs from United States. Great for scraping.",
			ProxyType:            models.ProxyTypeResidential,
			Protocol:             "HTTP",
			PricePerGB:           0.50,
			AvailableBandwidthGB: 1000,
			MaxConcurrency:       50,
			Status:               models.ListingStatusActive,
		},
		{
			SellerID:             provider.ID,
			Title:                "Mobile 4G Proxies (UK)",
			Description:          "Rotational 4G Mobile proxies from UK carriers.",
			ProxyType:            models.ProxyTypeMobile,
			Protocol:             "SOCKS5",
			PricePerGB:           1.20,
			AvailableBandwidthGB: 500,
			MaxConcurrency:       20,
			Status:               models.ListingStatusActive,
		},
	}

	for _, l := range listings {
		var existing models.ProxyListing
		if err := DB.Where("title = ? AND seller_id = ?", l.Title, l.SellerID).First(&existing).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				l.ID = uuid.New()
				if err := DB.Create(&l).Error; err != nil {
					log.Printf("Failed to seed listing %s: %v", l.Title, err)
				} else {
					log.Printf("Seeded listing: %s", l.Title)
				}
			}
		} else {
			log.Printf("Listing %s already exists", l.Title)
		}
	}
}

func stringPtr(s string) *string {
	return &s
}
