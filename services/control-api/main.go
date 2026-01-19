package main

import (
	"log"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/api"
	"github.com/proxyhubb/control-api/internal/config"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/indexer"
)

func main() {
	// Load Config
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	// Initialize DB
	if err := db.Init(cfg.Database.DatabaseURL); err != nil {
		log.Fatalf("Failed to init DB: %v", err)
	}

	r := gin.Default()

	// CORS
	r.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE, UPDATE")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, X-Requested-With")
		c.Writer.Header().Set("Access-Control-Expose-Headers", "Content-Length")
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	})

	// Metrics
	api.RegisterMetricsEndpoint(r)

	// Routes
	v1 := r.Group("/v1")
	{
		api.RegisterAuthRoutes(v1)
		api.RegisterProviderNodeRoutes(v1) // Fixed name
		api.RegisterListingRoutes(v1)      // Added Listings
		api.RegisterSessionRoutes(v1)
		// api.RegisterStatsRoutes(v1)     // Removed or renamed
		api.RegisterWalletRoutes(v1)
		api.RegisterOrderRoutes(v1)
		api.RegisterEscrowRoutes(v1)
	}

	// Start Chain Indexer
	idx := indexer.NewIndexer()
	idx.Start()

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Server starting on port %s", port)
	r.Run(":" + port)
}
