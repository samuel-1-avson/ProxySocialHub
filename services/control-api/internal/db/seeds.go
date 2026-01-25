package db

import (
	"log"
	"math/rand"
	"time"

	"os"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

func SeedAll() {
	if DB == nil {
		log.Println("DB not initialized, skipping seeds")
		return
	}

	log.Println("Cleaning up legacy mock data...")
	cleanMockData()

	// All functional seeds are disabled for production reality
	// seedUsers()
	// seedListings()
	// seedNodes()
	// seedWallet()
	// seedSessionsAndUsage()
	// seedMarketAgents()
	// seedBadges()

	log.Println("Seeding System Config...")
	seedSystemConfig()
	log.Println("Database seeding completed")
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

	now := time.Now()

	// Use ProviderNode struct which corresponds to "provider_nodes" table
	nodes := []models.ProviderNode{
		{
			Name:                "US-East-Node-1",
			UserID:              provider.ID,
			Country:             "US",
			City:                "New York",
			IPAddress:           "192.168.1.101",
			Status:              models.NodeOnline,
			QualityScore:        95.0,
			LastSeenAt:          &now,
			TotalBandwidthGB:    12.5,
			IsRegisteredOnChain: true,
		},
		{
			Name:                "GB-London-Node-1",
			UserID:              provider.ID,
			Country:             "GB",
			City:                "London",
			IPAddress:           "192.168.1.102",
			Status:              models.NodeOnline,
			QualityScore:        88.0,
			LastSeenAt:          &now,
			TotalBandwidthGB:    8.2,
			IsRegisteredOnChain: true,
		},
		{
			Name:                "GH-Accra-Node-1",
			UserID:              provider.ID,
			Country:             "GH",
			City:                "Accra",
			IPAddress:           "192.168.1.103",
			Status:              models.NodeOnline,
			QualityScore:        75.0,
			LastSeenAt:          &now,
			TotalBandwidthGB:    45.1,
			IsRegisteredOnChain: true,
		},
	}

	for _, n := range nodes {
		var existing models.ProviderNode
		if err := DB.Where("name = ? AND user_id = ?", n.Name, n.UserID).First(&existing).Error; err != nil {
			n.ID = uuid.New() // Ensure UUID is generated
			if err := DB.Create(&n).Error; err != nil {
				log.Printf("Failed to seed provider node %s: %v", n.Name, err)
			} else {
				log.Printf("Seeded provider node: %s", n.Name)
			}
		} else {
			// Update existing node to ensure fields are set
			DB.Model(&existing).Updates(n)
			log.Printf("Updated provider node: %s", n.Name)
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
			UserID:      user.ID,
			BalanceGHS:  0,
			BalanceSOL:  0,
			BalanceUSDT: 0,
			Currency:    "MULTI",
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
	// Target the specific logged-in user to ensure they see the data
	if err := DB.Where("email = ?", "samuelavson@gmail.com").First(&user).Error; err != nil {
		// Fallback
		if err := DB.Where("email = ?", "user@proxyhub.com").First(&user).Error; err != nil {
			return
		}
	}

	var node models.ProviderNode
	// Use ProviderNode instead of Node
	if err := DB.Where("country = 'GH'").First(&node).Error; err != nil {
		// Fallback to any provider node
		if err := DB.First(&node).Error; err != nil {
			log.Println("No provider nodes found, skipping usage seed")
			return
		}
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
	// We want to simulate traffic patterns used in dashboard charts

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
	log.Println("Seeded Analytics Data")
}

// seedMarketAgents seeds AI agents for the marketplace
func seedMarketAgents() {
	var count int64
	DB.Model(&models.MarketAgent{}).Count(&count)
	if count > 0 {
		return
	}

	agents := []models.MarketAgent{
		{
			Name:        "Social Media Manager",
			Description: "Automates your social presence. Schedules posts, replies to comments, and analyzes engagement.",
			Version:     "1.0.0",
			PricePerRun: 5.0,
			DockerImage: "proxyhub/agent-social:latest",
			Categories:  []string{"social", "marketing"},
			Parameters: map[string]any{
				"platforms": []string{"twitter", "linkedin"},
				"tone":      "professional",
			},
		},
		{
			Name:        "Code Reviewer",
			Description: "Analyzes pull requests for bugs, security issues, and style violations.",
			Version:     "2.1.0",
			PricePerRun: 10.0,
			DockerImage: "proxyhub/agent-code-review:latest",
			Categories:  []string{"development", "security"},
			Parameters: map[string]any{
				"languages":  []string{"go", "typescript", "rust"},
				"strictness": "high",
			},
		},
		{
			Name:        "Market Analyst",
			Description: "Scrapes and analyzes market data to identify trends and opportunities.",
			Version:     "1.5.0",
			PricePerRun: 15.0,
			DockerImage: "proxyhub/agent-analyst:latest",
			Categories:  []string{"finance", "data"},
			Parameters: map[string]any{
				"sectors": []string{"tech", "crypto"},
				"depth":   "deep",
			},
		},
	}

	for _, agent := range agents {
		if err := DB.Create(&agent).Error; err != nil {
			log.Printf("Failed to seed agent %s: %v", agent.Name, err)
		}
	}
	log.Println("Seeded Market Agents")
}

func seedBadges() {
	badges := []models.Badge{
		{
			Name:        "Reliable Node",
			Description: "Maintained >99% uptime for 7 days",
			Icon:        "shield-check",
			Criteria:    datatypes.JSON([]byte(`{"uptime_min": 99.0}`)),
		},
		{
			Name:        "Power Provider",
			Description: "Served over 1TB of traffic",
			Icon:        "lightning",
			Criteria:    datatypes.JSON([]byte(`{"traffic_min_gb": 1000}`)),
		},
		{
			Name:        "Early Adopter",
			Description: "Joined during the beta phase",
			Icon:        "rocket",
			Criteria:    datatypes.JSON([]byte(`{"joined_before": "2025-01-01"}`)),
		},
		{
			Name:        "Global Connector",
			Description: "Served clients from >10 different countries",
			Icon:        "globe",
			Criteria:    datatypes.JSON([]byte(`{"geo_diversity_min": 10}`)),
		},
	}

	for _, b := range badges {
		var existing models.Badge
		if err := DB.Where("name = ?", b.Name).First(&existing).Error; err != nil {
			b.ID = uuid.New()
			if err := DB.Create(&b).Error; err != nil {
				log.Printf("Failed to seed badge %s: %v", b.Name, err)
			} else {
				log.Printf("Seeded badge: %s", b.Name)
			}
		}
	}
}

func stringPtr(s string) *string {
	return &s
}

func cleanMockData() {
	// Delete users created by older seeds
	mockEmails := []string{"admin@proxyhub.com", "provider@proxyhub.com", "user@proxyhub.com"}
	DB.Unscoped().Where("email IN ?", mockEmails).Delete(&models.User{})

	// Delete listings created by older seeds
	mockListings := []string{"Premium Residential Proxies (US)", "Mobile 4G Proxies (UK)"}
	DB.Unscoped().Where("title IN ?", mockListings).Delete(&models.ProxyListing{})

	// Delete mock badges if any
	DB.Unscoped().Where("name IN ?", []string{"First Sale", "Top Provider", "Global Connector"}).Delete(&models.Badge{})

	log.Println("Successfully purged mock data from database")
}

func seedSystemConfig() {
	configs := []models.SystemConfiguration{
		{
			Key:         "treasury_wallet_solana",
			Value:       os.Getenv("SOLANA_TREASURY_ADDRESS"),
			Description: "Central Treasury Wallet for Solana Deposits",
		},
	}

	for _, c := range configs {
		var existing models.SystemConfiguration
		if err := DB.Where("key = ?", c.Key).First(&existing).Error; err == nil {
			// Update existing record
			if existing.Value != c.Value {
				DB.Model(&existing).Update("value", c.Value)
				log.Printf("Updated config: %s to %s", c.Key, c.Value)
			}
		} else if err == gorm.ErrRecordNotFound {
			// Create new record
			c.ID = uuid.New()
			if err := DB.Create(&c).Error; err != nil {
				log.Printf("Failed to seed config %s: %v", c.Key, err)
			} else {
				log.Printf("Seeded config: %s", c.Key)
			}
		}
	}
}
