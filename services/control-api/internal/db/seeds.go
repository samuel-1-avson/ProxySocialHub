package db

import (
	"log"
	"math/rand"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
)

func SeedAll() {
	if DB == nil {
		log.Println("DB not initialized, skipping seeds")
		return
	}

	log.Println("Seeding Users...")
	seedUsers()
	log.Println("Seeding Listings...")
	seedListings()
	log.Println("Seeding Nodes...")
	seedNodes()
	log.Println("Seeding Wallet & Transactions...")
	seedWallet()
	log.Println("Seeding Sessions & Usage...")
	seedSessionsAndUsage()
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

func seedNodes() {
	var provider models.User
	// Try to find the logged-in user first to populate their dashboard
	if err := DB.Where("email = ?", "samuelavson@gmail.com").First(&provider).Error; err != nil {
		// Fallback to default provider
		if err := DB.Where("email = ?", "provider@proxyhub.com").First(&provider).Error; err != nil {
			return
		}
	}

	nodes := []models.Node{
		{
			// Name removed
			ProviderUserID: provider.ID,
			CountryCode:    "US",
			Region:         "North America",
			City:           "New York",
			ISP:            "Verizon Fios",
			IPAddress:      "192.168.1.101",
			Port:           8080,
			// Status removed if not present or mapped to IsHealthy? Model has IsHealthy (bool)
			// Status:            "online", -> Model has IsHealthy
			LatencyMs:         45,
			UptimePercent:     99.9,
			QualityScore:      95.0, // Model uses float64
			ActiveConnections: 12,
			IsHealthy:         true,
			// LastHeartbeat -> LastSeenAt
			LastSeenAt: time.Now(),
		},
		{
			ProviderUserID:    provider.ID,
			CountryCode:       "GB",
			Region:            "Europe",
			City:              "London",
			ISP:               "Virgin Media",
			IPAddress:         "192.168.1.102",
			Port:              8080,
			LatencyMs:         35,
			UptimePercent:     98.5,
			QualityScore:      88.0,
			ActiveConnections: 8,
			IsHealthy:         true,
			LastSeenAt:        time.Now(),
		},
		{
			ProviderUserID:    provider.ID,
			CountryCode:       "GH",
			Region:            "Africa",
			City:              "Accra",
			ISP:               "MTN Ghana",
			IPAddress:         "192.168.1.103",
			Port:              8080,
			LatencyMs:         120,
			UptimePercent:     95.0,
			QualityScore:      75.0,
			ActiveConnections: 45,
			IsHealthy:         true,
			LastSeenAt:        time.Now(),
		},
	}

	for _, n := range nodes {
		var existing models.Node
		if err := DB.Where("ip_address = ?", n.IPAddress).First(&existing).Error; err != nil {
			n.ID = uuid.New() // Ensure UUID is generated
			if err := DB.Create(&n).Error; err != nil {
				log.Printf("Failed to seed node %s: %v", n.IPAddress, err)
			} else {
				log.Printf("Seeded node: %s", n.IPAddress)
			}
		}
	}
}

func seedWallet() {
	var user models.User
	if err := DB.Where("email = ?", "user@proxyhub.com").First(&user).Error; err != nil {
		return
	}

	// 1. Create Wallet if not exists
	var wallet models.Wallet
	if err := DB.Where("user_id = ?", user.ID).First(&wallet).Error; err != nil {
		wallet = models.Wallet{
			UserID:   user.ID,
			Balance:  500.00,
			Currency: "GHS",
		}
		if err := DB.Create(&wallet).Error; err != nil {
			log.Printf("Failed to create wallet: %v", err)
			return
		}
		log.Println("Created wallet for user")
	}

	// 2. Seed Transactions
	txs := []models.WalletLedgerEntry{
		{
			WalletID:     wallet.ID,
			Amount:       1000.00,
			BalanceAfter: 1000.00,
			Type:         models.TransactionTopup,
			Description:  "Initial Deposit via MoMo",
			ReferenceID:  "MOMO-123456",
			CreatedAt:    time.Now().AddDate(0, 0, -10),
		},
		{
			WalletID:     wallet.ID,
			Amount:       -200.00,
			BalanceAfter: 800.00,
			Type:         models.TransactionUsage,
			Description:  "Proxy Usage Charge - Bundle Purchase",
			CreatedAt:    time.Now().AddDate(0, 0, -5),
		},
		{
			WalletID:     wallet.ID,
			Amount:       -300.00,
			BalanceAfter: 500.00,
			Type:         models.TransactionUsage,
			Description:  "Proxy Usage - Pay As You Go",
			CreatedAt:    time.Now().AddDate(0, 0, -2),
		},
	}

	for _, tx := range txs {
		var existing models.WalletLedgerEntry
		if err := DB.Where("wallet_id = ? AND description = ?", tx.WalletID, tx.Description).First(&existing).Error; err != nil {
			tx.ID = uuid.New()
			DB.Create(&tx)
		}
	}
}

func seedSessionsAndUsage() {
	var user models.User
	if err := DB.Where("email = ?", "user@proxyhub.com").First(&user).Error; err != nil {
		return
	}

	var node models.Node
	if err := DB.Where("country_code = 'GH'").First(&node).Error; err != nil {
		// Fallback to any node
		DB.First(&node)
	}

	// 1. Active Session
	session := models.Session{
		UserID:          user.ID,
		NodeID:          &node.ID,
		Type:            models.SessionRotating,
		Status:          models.SessionActive,
		CredentialsUser: "user-" + user.ID.String()[:8],
		CredentialsPass: "pass-secret",
		StartTime:       time.Now().Add(-2 * time.Hour),
		BytesUsed:       1024 * 1024 * 150, // 150MB
	}

	// Check if active session exists
	var existingSession models.Session
	err := DB.Where("user_id = ? AND status = 'active'", user.ID).First(&existingSession).Error
	if err != nil {
		session.ID = uuid.New()
		DB.Create(&session)
		log.Println("Created active session")
		existingSession = session
	}

	// 2. Generate Usage Records for Analytics (Past 7 days)
	// We want to simulate traffic patterns

	// Only seed if we don't have many records
	var count int64
	DB.Model(&models.UsageRecord{}).Where("user_id = ?", user.ID).Count(&count)
	if count > 100 {
		log.Println("Usage records already seeded, skipping")
		return
	}

	log.Println("Generating analytic data points...")

	targets := []string{"google.com", "facebook.com", "amazon.com", "jumia.com.gh", "twitter.com", "linkedin.com"}

	for i := 0; i < 7; i++ {
		date := time.Now().AddDate(0, 0, -i)

		// Random number of requests per day (50-200)
		numReqs := 50 + rand.Intn(150)

		for j := 0; j < numReqs; j++ {
			// Random time within that day
			hour := rand.Intn(24)
			minute := rand.Intn(60)
			timestamp := time.Date(date.Year(), date.Month(), date.Day(), hour, minute, 0, 0, date.Location())

			bytes := int64(rand.Intn(1024 * 1024 * 5)) // Up to 5MB
			host := targets[rand.Intn(len(targets))]
			latency := 20 + rand.Intn(200)

			record := models.UsageRecord{
				ID:        uuid.New(),
				UserID:    user.ID,
				SessionID: existingSession.ID,
				NodeID:    &node.ID,
				BytesUsed: bytes,
				BytesUp:   bytes / 3,
				BytesDown: (bytes / 3) * 2,
				DestHost:  host,
				DestPort:  443,
				LatencyMs: latency,
				Success:   rand.Float32() > 0.05, // 95% success
				CreatedAt: timestamp,
			}
			DB.Create(&record)
		}
	}
}

func stringPtr(s string) *string {
	return &s
}
