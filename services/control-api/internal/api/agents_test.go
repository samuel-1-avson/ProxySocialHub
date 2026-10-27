package api_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/api"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
	"github.com/stretchr/testify/assert"
)

func TestAgentMarketplace(t *testing.T) {
	// Setup
	router := testutil.SetupTestRouter()
	testutil.SetupTestDB(t)
	defer testutil.CleanupTestData(t)

	// Register routes manually since they are protected
	v1 := router.Group("/v1")
	v1.Use(func(c *gin.Context) {
		c.Set("userID", testutil.GetTestUserID()) // Mock Auth
		c.Next()
	})
	api.RegisterAgentRoutes(v1)

	// Create Test User
	userID := testutil.GetTestUserID()
	uid, _ := uuid.Parse(userID)
	user := models.User{
		ID:        uid,
		Email:     "test@agent.com",
		Role:      "buyer",
		TrustTier: models.TrustTierNew,
	}
	if err := db.DB.Create(&user).Error; err != nil {
		t.Fatalf("Failed to create test user: %v", err)
	}

	// Seed Market Agent
	agent := models.MarketAgent{
		Name:        "Twitter Sentiment Analyzer",
		Description: "Analyzes crypto twitter sentiment",
		Version:     "1.0.0",
		PricePerRun: 10.0,
		DockerImage: "proxyhub/sentiment:latest",
		Categories:  []string{"social", "finance"},
	}
	if err := db.DB.Create(&agent).Error; err != nil {
		t.Fatalf("Failed to create agent: %v", err)
	}

	// 1. List Agents
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/v1/agents", nil)
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var agents []models.MarketAgent
	json.Unmarshal(w.Body.Bytes(), &agents)

	if len(agents) == 0 {
		t.Fatal("Expected agents list to not be empty")
	}
	assert.Equal(t, agent.Name, agents[0].Name)

	// 2. Rent Agent
	rentPayload := map[string]interface{}{
		"market_agent_id": agent.ID.String(),
		"name":            "My Sentiment Bot",
		"config":          map[string]interface{}{"keyword": "BTC"},
	}
	payloadBytes, _ := json.Marshal(rentPayload)

	w = httptest.NewRecorder()
	req, _ = http.NewRequest("POST", "/v1/agents/rent", bytes.NewBuffer(payloadBytes))
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusCreated, w.Code)
	var instance models.AgentInstance
	json.Unmarshal(w.Body.Bytes(), &instance)
	assert.Equal(t, "My Sentiment Bot", instance.Name)

	// 3. List Instances
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("GET", "/v1/agents/instances", nil)
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var instances []models.AgentInstance
	json.Unmarshal(w.Body.Bytes(), &instances)
	assert.GreaterOrEqual(t, len(instances), 1)

	// 4. Execute Job
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("POST", "/v1/agents/instances/"+instance.ID.String()+"/execute", nil)
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusAccepted, w.Code)
	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)
	assert.Equal(t, "Job queued for autonomous execution", response["message"])
}

func TestAgentRouteAuthPolicy_PublicBrowseProtectedActions(t *testing.T) {
	router := testutil.SetupTestRouter()
	testutil.SetupTestDB(t)
	defer testutil.CleanupTestData(t)

	agent := models.MarketAgent{
		Name:        "Public Agent",
		Description: "Visible in public marketplace",
		Version:     "1.0.0",
		PricePerRun: 5.0,
		DockerImage: "proxyhub/public-agent:latest",
		Categories:  []string{"utility"},
	}
	if err := db.DB.Create(&agent).Error; err != nil {
		t.Fatalf("Failed to create agent: %v", err)
	}

	v1 := router.Group("/v1")
	api.RegisterAgentPublicRoutes(v1)

	protected := v1.Group("")
	protected.Use(func(c *gin.Context) {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "auth required"})
	})
	api.RegisterAgentProtectedRoutes(protected)

	t.Run("public list agents does not require auth", func(t *testing.T) {
		w := httptest.NewRecorder()
		req, _ := http.NewRequest("GET", "/v1/agents", nil)
		router.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
	})

	t.Run("rent requires auth", func(t *testing.T) {
		payloadBytes, _ := json.Marshal(map[string]interface{}{
			"market_agent_id": agent.ID.String(),
			"name":            "Blocked",
		})

		w := httptest.NewRecorder()
		req, _ := http.NewRequest("POST", "/v1/agents/rent", bytes.NewBuffer(payloadBytes))
		router.ServeHTTP(w, req)

		assert.Equal(t, http.StatusUnauthorized, w.Code)
	})

	t.Run("instances requires auth", func(t *testing.T) {
		w := httptest.NewRecorder()
		req, _ := http.NewRequest("GET", "/v1/agents/instances", nil)
		router.ServeHTTP(w, req)

		assert.Equal(t, http.StatusUnauthorized, w.Code)
	})
}
