package api

import (
	"net/http"
	"os"
	"strconv"
	"time"

	solanaGo "github.com/gagliardetto/solana-go"
	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/solana"
)

// RegisterExplorerRoutes registers all public explorer endpoints
func RegisterExplorerRoutes(r *gin.RouterGroup) {
	explorer := r.Group("/explorer")
	{
		// Dashboard metrics
		explorer.GET("/metrics", getExplorerMetrics)
		explorer.GET("/stats", getNetworkStats)

		// Transactions
		explorer.GET("/transactions", listTransactions)
		explorer.GET("/transactions/:hash", getTransactionByHash)

		// Wallets/Addresses
		explorer.GET("/wallets/:address", getWalletDetails)
		explorer.GET("/wallets/:address/transactions", getWalletTransactions)

		// Blocks
		explorer.GET("/blocks", listBlocks)
		explorer.GET("/blocks/:identifier", getBlockByIdentifier) // hash or number

		// Nodes & Validators
		explorer.GET("/nodes", listExplorerNodes)
		explorer.GET("/nodes/:id", getExplorerNodeDetails)
		explorer.GET("/validators", listExplorerValidators)

		// Smart Contracts
		explorer.GET("/contracts", listContracts)
		explorer.GET("/contracts/:address", getContractDetails)

		// Bandwidth & Network
		explorer.GET("/bandwidth", getBandwidthStats)
		explorer.GET("/network/health", getNetworkHealth)
	}
}

// ============================================================
// Response DTOs
// ============================================================

type ExplorerMetricsResponse struct {
	Chain              string         `json:"chain"`
	TotalTransactions  uint64         `json:"total_transactions"`
	TotalVolume        float64        `json:"total_volume"`
	ActiveWallets      uint64         `json:"active_wallets"`
	ActiveNodes        uint64         `json:"active_nodes"`
	BlockHeight        uint64         `json:"block_height"`
	AvgBlockTime       float64        `json:"avg_block_time_ms"`
	TotalBandwidthGB   float64        `json:"total_bandwidth_gb"`
	TPS                float64        `json:"transactions_per_second"`
	RegionDistribution map[string]int `json:"region_distribution,omitempty"`
	LastUpdated        time.Time      `json:"last_updated"`
}

type TransactionListResponse struct {
	Transactions []TransactionSummary `json:"transactions"`
	Total        int64                `json:"total"`
	Page         int                  `json:"page"`
	PageSize     int                  `json:"page_size"`
}

type TransactionSummary struct {
	TxHash      string    `json:"tx_hash"`
	Chain       string    `json:"chain"`
	FromAddress string    `json:"from_address"`
	ToAddress   string    `json:"to_address"`
	Amount      float64   `json:"amount"`
	Currency    string    `json:"currency"`
	Status      string    `json:"status"`
	TxType      string    `json:"tx_type"`
	Timestamp   time.Time `json:"timestamp"`
	Fee         float64   `json:"fee"`
}

type TransactionDetailResponse struct {
	TxHash        string                 `json:"tx_hash"`
	Chain         string                 `json:"chain"`
	BlockHash     string                 `json:"block_hash"`
	BlockNumber   uint64                 `json:"block_number"`
	FromAddress   string                 `json:"from_address"`
	ToAddress     string                 `json:"to_address"`
	Amount        float64                `json:"amount"`
	Currency      string                 `json:"currency"`
	Fee           float64                `json:"fee"`
	Status        string                 `json:"status"`
	TxType        string                 `json:"tx_type"`
	ProgramID     string                 `json:"program_id,omitempty"`
	Timestamp     time.Time              `json:"timestamp"`
	Confirmations int                    `json:"confirmations"`
	RawData       map[string]interface{} `json:"raw_data,omitempty"`
}

type WalletDetailsResponse struct {
	Address          string    `json:"address"`
	Chain            string    `json:"chain"`
	BalanceSOL       float64   `json:"balance_sol"`
	BalancePlatform  float64   `json:"balance_platform"`
	TransactionCount int64     `json:"transaction_count"`
	FirstActivity    time.Time `json:"first_activity"`
	LastActivity     time.Time `json:"last_activity"`
	IsContract       bool      `json:"is_contract"`
	LinkedUserID     string    `json:"linked_user_id,omitempty"` // Only if registered
}

type BlockListResponse struct {
	Blocks   []BlockSummary `json:"blocks"`
	Total    int64          `json:"total"`
	Page     int            `json:"page"`
	PageSize int            `json:"page_size"`
}

type BlockSummary struct {
	BlockHash        string    `json:"block_hash"`
	BlockNumber      uint64    `json:"block_number"`
	Chain            string    `json:"chain"`
	Timestamp        time.Time `json:"timestamp"`
	TransactionCount int       `json:"transaction_count"`
	ValidatorPubkey  string    `json:"validator_pubkey,omitempty"`
}

type BlockDetailResponse struct {
	BlockHash        string               `json:"block_hash"`
	BlockNumber      uint64               `json:"block_number"`
	Chain            string               `json:"chain"`
	ParentHash       string               `json:"parent_hash"`
	Timestamp        time.Time            `json:"timestamp"`
	TransactionCount int                  `json:"transaction_count"`
	Slot             uint64               `json:"slot,omitempty"`
	ValidatorPubkey  string               `json:"validator_pubkey,omitempty"`
	Transactions     []TransactionSummary `json:"transactions,omitempty"`
}

type NodeListResponse struct {
	Nodes    []NodeSummary `json:"nodes"`
	Total    int64         `json:"total"`
	Active   int64         `json:"active"`
	Page     int           `json:"page"`
	PageSize int           `json:"page_size"`
}

type NodeSummary struct {
	NodeID         string    `json:"node_id"`
	Name           string    `json:"name,omitempty"`
	Chain          string    `json:"chain"`
	Region         string    `json:"region"`
	Country        string    `json:"country"`
	IsActive       bool      `json:"is_active"`
	IsValidator    bool      `json:"is_validator"`
	UptimePercent  float64   `json:"uptime_percent"`
	ActiveSessions int       `json:"active_sessions"`
	BandwidthGB    float64   `json:"bandwidth_gb"`
	LastHeartbeat  time.Time `json:"last_heartbeat"`
}

type NodeDetailResponse struct {
	NodeSummary
	StakeAmount    float64 `json:"stake_amount,omitempty"`
	CommissionRate float64 `json:"commission_rate,omitempty"`
	Version        string  `json:"version,omitempty"`
	TotalBandwidth uint64  `json:"total_bandwidth_bytes"`
}

type ContractListResponse struct {
	Contracts []ContractSummary `json:"contracts"`
	Total     int64             `json:"total"`
	Page      int               `json:"page"`
	PageSize  int               `json:"page_size"`
}

type ContractSummary struct {
	Address      string    `json:"address"`
	Chain        string    `json:"chain"`
	Name         string    `json:"name"`
	ContractType string    `json:"contract_type"`
	IsVerified   bool      `json:"is_verified"`
	TotalCalls   uint64    `json:"total_calls"`
	DeployedAt   time.Time `json:"deployed_at"`
}

type BandwidthStatsResponse struct {
	TotalBandwidthGB      float64            `json:"total_bandwidth_gb"`
	Last24HoursBandwidth  float64            `json:"last_24h_bandwidth_gb"`
	ActiveConnections     int64              `json:"active_connections"`
	AverageThroughputMbps float64            `json:"avg_throughput_mbps"`
	BandwidthByRegion     map[string]float64 `json:"bandwidth_by_region"`
	TopProviders          []ProviderBWStats  `json:"top_providers"`
}

type ProviderBWStats struct {
	NodeID       string  `json:"node_id"`
	BandwidthGB  float64 `json:"bandwidth_gb"`
	SessionCount int     `json:"session_count"`
}

type NetworkHealthResponse struct {
	Status            string    `json:"status"` // "healthy", "degraded", "down"
	SolanaHealth      string    `json:"solana_health"`
	DatabaseHealth    string    `json:"database_health"`
	ActiveNodes       int64     `json:"active_nodes"`
	AvgResponseTimeMs float64   `json:"avg_response_time_ms"`
	LastChecked       time.Time `json:"last_checked"`
}

// ============================================================
// Handler Implementations
// ============================================================

func getExplorerMetrics(c *gin.Context) {
	chain := c.DefaultQuery("chain", "all")

	// Default to solana if 'all' is requested, as we only want proxy blockchain now
	if chain == "all" || chain == "" {
		chain = "solana"
	}

	// Get from cache first, fallback to live query
	var metrics models.ExplorerMetrics

	// Try database cache (hourly aggregated)
	if err := db.DB.Where("chain = ? AND period = ?", chain, "hourly").
		Order("period_start DESC").First(&metrics).Error; err == nil {
		// Cache hit, return cached data
		c.JSON(http.StatusOK, ExplorerMetricsResponse{
			Chain:             metrics.Chain,
			TotalTransactions: metrics.TotalTransactions,
			TotalVolume:       metrics.TotalVolume,
			ActiveWallets:     metrics.ActiveWallets,
			ActiveNodes:       metrics.ActiveNodes,
			AvgBlockTime:      metrics.AverageBlockTime,
			TotalBandwidthGB:  float64(metrics.TotalBandwidthBytes) / (1024 * 1024 * 1024),
			LastUpdated:       metrics.CreatedAt,
		})
		return
	}

	// Cache miss - compute live metrics
	var txCount int64
	var nodeCount int64
	var walletCount int64

	db.DB.Model(&models.ExplorerTransaction{}).Where("chain = ?", "solana").Count(&txCount)
	db.DB.Model(&models.ExplorerNode{}).Where("is_active = ? AND chain = ?", true, "solana").Count(&nodeCount)
	db.DB.Model(&models.Wallet{}).Count(&walletCount)

	// Get latest block height from Solana (via RPC if available)
	blockHeight := uint64(0)
	// Note: Block height would be fetched via Solana RPC websocket subscription
	// For now, using cached value from database
	var latestBlock models.ExplorerBlock
	if err := db.DB.Order("block_number DESC").First(&latestBlock).Error; err == nil {
		blockHeight = latestBlock.BlockNumber
	}

	// Get regional distribution
	var regionStats []struct {
		Region string
		Count  int
	}
	db.DB.Model(&models.ExplorerNode{}).Where("is_active = ?", true).Select("region, count(*) as count").Group("region").Scan(&regionStats)

	regionDist := make(map[string]int)
	for _, s := range regionStats {
		rname := s.Region
		if rname == "" {
			rname = "Other"
		}
		regionDist[rname] = s.Count
	}

	c.JSON(http.StatusOK, ExplorerMetricsResponse{
		Chain:              chain,
		TotalTransactions:  uint64(txCount),
		ActiveWallets:      uint64(walletCount),
		ActiveNodes:        uint64(nodeCount),
		BlockHeight:        blockHeight,
		RegionDistribution: regionDist,
		LastUpdated:        time.Now(),
	})
}

func getNetworkStats(c *gin.Context) {
	// Aggregate stats from multiple sources
	var stats struct {
		TotalTx     int64
		TotalVolume float64
		ActiveNodes int64
	}

	db.DB.Model(&models.ExplorerTransaction{}).Where("chain = ?", "solana").Count(&stats.TotalTx)
	db.DB.Model(&models.ExplorerTransaction{}).Where("chain = ?", "solana").Select("COALESCE(SUM(amount), 0)").Scan(&stats.TotalVolume)
	db.DB.Model(&models.ExplorerNode{}).Where("is_active = ? AND chain = ?", true, "solana").Count(&stats.ActiveNodes)

	c.JSON(http.StatusOK, gin.H{
		"total_transactions": stats.TotalTx,
		"total_volume":       stats.TotalVolume,
		"active_nodes":       stats.ActiveNodes,
		"timestamp":          time.Now(),
	})
}

func listTransactions(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	chain := c.Query("chain")
	txType := c.Query("type")
	status := c.Query("status")
	address := c.Query("address")

	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	offset := (page - 1) * pageSize

	query := db.DB.Model(&models.ExplorerTransaction{})

	if chain != "" {
		query = query.Where("chain = ?", chain)
	}
	if txType != "" {
		query = query.Where("tx_type = ?", txType)
	}
	if status != "" {
		query = query.Where("status = ?", status)
	}
	if address != "" {
		query = query.Where("from_address = ? OR to_address = ?", address, address)
	}

	var total int64
	query.Count(&total)

	var transactions []models.ExplorerTransaction
	if err := query.Order("timestamp DESC").Offset(offset).Limit(pageSize).Find(&transactions).Error; err != nil {
		logging.Error(err).Msg("[ProxyExplorer] Database query failed for listTransactions")
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Proxy Explorer: Failed to fetch transactions",
			"details": err.Error(),
		})
		return
	}

	summaries := make([]TransactionSummary, len(transactions))
	for i, tx := range transactions {
		summaries[i] = TransactionSummary{
			TxHash:      tx.TxHash,
			Chain:       tx.Chain,
			FromAddress: tx.FromAddress,
			ToAddress:   tx.ToAddress,
			Amount:      tx.Amount,
			Currency:    tx.Currency,
			Status:      tx.Status,
			TxType:      tx.TxType,
			Timestamp:   tx.Timestamp,
			Fee:         tx.Fee,
		}
	}

	c.JSON(http.StatusOK, TransactionListResponse{
		Transactions: summaries,
		Total:        total,
		Page:         page,
		PageSize:     pageSize,
	})
}

func getTransactionByHash(c *gin.Context) {
	hash := c.Param("hash")

	if hash == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Transaction hash required"})
		return
	}

	// Try database cache first
	var tx models.ExplorerTransaction
	if err := db.DB.Where("tx_hash = ?", hash).First(&tx).Error; err == nil {
		c.JSON(http.StatusOK, TransactionDetailResponse{
			TxHash:        tx.TxHash,
			Chain:         tx.Chain,
			BlockHash:     tx.BlockHash,
			BlockNumber:   tx.BlockNumber,
			FromAddress:   tx.FromAddress,
			ToAddress:     tx.ToAddress,
			Amount:        tx.Amount,
			Currency:      tx.Currency,
			Fee:           tx.Fee,
			Status:        tx.Status,
			TxType:        tx.TxType,
			ProgramID:     tx.ProgramID,
			Timestamp:     tx.Timestamp,
			Confirmations: tx.Confirmations,
		})
		return
	}

	// For cache miss, we would query Solana RPC directly
	if oracle := solana.GetOracle(); oracle != nil {
		rpcTx, err := oracle.GetTransaction(c.Request.Context(), hash)
		if err == nil && rpcTx != nil && rpcTx.Transaction != nil {
			// Convert RPC result to our DTO
			// This is a simplified conversion for now
			c.JSON(http.StatusOK, TransactionDetailResponse{
				TxHash:        hash,
				Chain:         "solana",
				Confirmations: 1, // Finalized
				Status:        "confirmed",
				Timestamp:     time.Now(), // RPC might have block time but need metadata
			})
			return
		}
	}

	c.JSON(http.StatusNotFound, gin.H{"error": "Transaction not found"})
}

func getWalletDetails(c *gin.Context) {
	address := c.Param("address")

	if address == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Address required"})
		return
	}

	// Query transaction counts
	var txCount int64
	db.DB.Model(&models.ExplorerTransaction{}).
		Where("from_address = ? OR to_address = ?", address, address).
		Count(&txCount)

	// Get first and last activity
	var firstTx, lastTx models.ExplorerTransaction
	db.DB.Where("from_address = ? OR to_address = ?", address, address).
		Order("timestamp ASC").First(&firstTx)
	db.DB.Where("from_address = ? OR to_address = ?", address, address).
		Order("timestamp DESC").First(&lastTx)

	// Get balance from Solana RPC
	var balanceSOL float64
	if oracle := solana.GetOracle(); oracle != nil {
		pubkey, err := solanaGo.PublicKeyFromBase58(address)
		if err == nil {
			// Get balance returns lamports (uint64)
			if bal, err := oracle.GetBalance(c.Request.Context(), pubkey); err == nil {
				balanceSOL = float64(bal) / 1e9
			}
		}
	}

	// Check if this address is linked to a platform user
	var linkedUserID string
	var user models.User
	if err := db.DB.Where("wallet_address = ?", address).First(&user).Error; err == nil {
		linkedUserID = user.ID.String()
	}

	c.JSON(http.StatusOK, WalletDetailsResponse{
		Address:          address,
		Chain:            "solana",
		BalanceSOL:       balanceSOL,
		TransactionCount: txCount,
		FirstActivity:    firstTx.Timestamp,
		LastActivity:     lastTx.Timestamp,
		LinkedUserID:     linkedUserID,
	})
}

func getWalletTransactions(c *gin.Context) {
	address := c.Param("address")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))

	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	offset := (page - 1) * pageSize

	var total int64
	query := db.DB.Model(&models.ExplorerTransaction{}).
		Where("from_address = ? OR to_address = ?", address, address)
	query.Count(&total)

	var transactions []models.ExplorerTransaction
	if err := query.Order("timestamp DESC").Offset(offset).Limit(pageSize).Find(&transactions).Error; err != nil {
		logging.Error(err).Msg("[ProxyExplorer] Database query failed for getWalletTransactions")
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Proxy Explorer: Failed to fetch wallet transactions",
			"details": err.Error(),
		})
		return
	}

	summaries := make([]TransactionSummary, len(transactions))
	for i, tx := range transactions {
		summaries[i] = TransactionSummary{
			TxHash:      tx.TxHash,
			Chain:       tx.Chain,
			FromAddress: tx.FromAddress,
			ToAddress:   tx.ToAddress,
			Amount:      tx.Amount,
			Currency:    tx.Currency,
			Status:      tx.Status,
			TxType:      tx.TxType,
			Timestamp:   tx.Timestamp,
			Fee:         tx.Fee,
		}
	}

	c.JSON(http.StatusOK, TransactionListResponse{
		Transactions: summaries,
		Total:        total,
		Page:         page,
		PageSize:     pageSize,
	})
}

func listBlocks(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	chain := c.DefaultQuery("chain", "solana")

	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	offset := (page - 1) * pageSize

	var total int64
	query := db.DB.Model(&models.ExplorerBlock{}).Where("chain = ?", chain)
	query.Count(&total)

	var blocks []models.ExplorerBlock
	if err := query.Order("block_number DESC").Offset(offset).Limit(pageSize).Find(&blocks).Error; err != nil {
		logging.Error(err).Msg("[ProxyExplorer] Database query failed for listBlocks")
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Proxy Explorer: Failed to fetch blocks",
			"details": err.Error(),
		})
		return
	}

	summaries := make([]BlockSummary, len(blocks))
	for i, b := range blocks {
		summaries[i] = BlockSummary{
			BlockHash:        b.BlockHash,
			BlockNumber:      b.BlockNumber,
			Chain:            b.Chain,
			Timestamp:        b.Timestamp,
			TransactionCount: b.TransactionCount,
			ValidatorPubkey:  b.ValidatorPubkey,
		}
	}

	c.JSON(http.StatusOK, BlockListResponse{
		Blocks:   summaries,
		Total:    total,
		Page:     page,
		PageSize: pageSize,
	})
}

func getBlockByIdentifier(c *gin.Context) {
	identifier := c.Param("identifier")

	if identifier == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Block identifier required"})
		return
	}

	var block models.ExplorerBlock

	// Try as block number first
	if blockNum, err := strconv.ParseUint(identifier, 10, 64); err == nil {
		if err := db.DB.Where("block_number = ?", blockNum).First(&block).Error; err == nil {
			returnBlockDetail(c, block)
			return
		}
	}

	// Try as block hash
	if err := db.DB.Where("block_hash = ?", identifier).First(&block).Error; err == nil {
		returnBlockDetail(c, block)
		return
	}

	c.JSON(http.StatusNotFound, gin.H{"error": "Block not found"})
}

func returnBlockDetail(c *gin.Context, block models.ExplorerBlock) {
	// Get transactions in this block
	var transactions []models.ExplorerTransaction
	db.DB.Where("block_hash = ?", block.BlockHash).Limit(100).Find(&transactions)

	txSummaries := make([]TransactionSummary, len(transactions))
	for i, tx := range transactions {
		txSummaries[i] = TransactionSummary{
			TxHash:      tx.TxHash,
			FromAddress: tx.FromAddress,
			ToAddress:   tx.ToAddress,
			Amount:      tx.Amount,
			Currency:    tx.Currency,
			Status:      tx.Status,
			TxType:      tx.TxType,
			Timestamp:   tx.Timestamp,
		}
	}

	c.JSON(http.StatusOK, BlockDetailResponse{
		BlockHash:        block.BlockHash,
		BlockNumber:      block.BlockNumber,
		Chain:            block.Chain,
		ParentHash:       block.ParentHash,
		Timestamp:        block.Timestamp,
		TransactionCount: block.TransactionCount,
		Slot:             block.Slot,
		ValidatorPubkey:  block.ValidatorPubkey,
		Transactions:     txSummaries,
	})
}

func listExplorerNodes(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	activeOnly := c.DefaultQuery("active", "true") == "true"
	region := c.Query("region")

	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	offset := (page - 1) * pageSize

	query := db.DB.Model(&models.ExplorerNode{}).Where("chain = ?", "solana")
	if activeOnly {
		query = query.Where("is_active = ?", true)
	}
	if region != "" {
		query = query.Where("region = ?", region)
	}

	var total, activeCount int64
	query.Count(&total)
	db.DB.Model(&models.ExplorerNode{}).Where("is_active = ? AND chain = ?", true, "solana").Count(&activeCount)

	var nodes []models.ExplorerNode
	if err := query.Order("uptime_percent DESC").Offset(offset).Limit(pageSize).Find(&nodes).Error; err != nil {
		logging.Error(err).Msg("[ProxyExplorer] Database query failed for listExplorerNodes")
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Proxy Explorer: Failed to fetch nodes",
			"details": err.Error(),
		})
		return
	}

	summaries := make([]NodeSummary, len(nodes))
	for i, n := range nodes {
		summaries[i] = NodeSummary{
			NodeID:         n.NodeID,
			Name:           n.Name,
			Chain:          n.Chain,
			Region:         n.Region,
			Country:        n.Country,
			IsActive:       n.IsActive,
			IsValidator:    n.IsValidator,
			UptimePercent:  n.UptimePercent,
			ActiveSessions: n.ActiveSessions,
			BandwidthGB:    float64(n.TotalBandwidth) / (1024 * 1024 * 1024),
			LastHeartbeat:  n.LastHeartbeat,
		}
	}

	c.JSON(http.StatusOK, NodeListResponse{
		Nodes:    summaries,
		Total:    total,
		Active:   activeCount,
		Page:     page,
		PageSize: pageSize,
	})
}

func getExplorerNodeDetails(c *gin.Context) {
	nodeID := c.Param("id")

	var node models.ExplorerNode
	if err := db.DB.Where("node_id = ?", nodeID).First(&node).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Node not found"})
		return
	}

	c.JSON(http.StatusOK, NodeDetailResponse{
		NodeSummary: NodeSummary{
			NodeID:         node.NodeID,
			Name:           node.Name,
			Chain:          node.Chain,
			Region:         node.Region,
			Country:        node.Country,
			IsActive:       node.IsActive,
			IsValidator:    node.IsValidator,
			UptimePercent:  node.UptimePercent,
			ActiveSessions: node.ActiveSessions,
			BandwidthGB:    float64(node.TotalBandwidth) / (1024 * 1024 * 1024),
			LastHeartbeat:  node.LastHeartbeat,
		},
		StakeAmount:    node.StakeAmount,
		CommissionRate: node.CommissionRate,
		Version:        node.Version,
		TotalBandwidth: node.TotalBandwidth,
	})
}

func listExplorerValidators(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))

	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 50 {
		pageSize = 20
	}

	offset := (page - 1) * pageSize

	var total int64
	query := db.DB.Model(&models.ExplorerNode{}).Where("is_validator = ? AND is_active = ? AND chain = ?", true, true, "solana")
	query.Count(&total)

	var validators []models.ExplorerNode
	if err := query.Order("stake_amount DESC").Offset(offset).Limit(pageSize).Find(&validators).Error; err != nil {
		logging.Error(err).Msg("[ProxyExplorer] Database query failed for listExplorerValidators")
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Proxy Explorer: Failed to fetch validators",
			"details": err.Error(),
		})
		return
	}

	summaries := make([]NodeSummary, len(validators))
	for i, v := range validators {
		summaries[i] = NodeSummary{
			NodeID:        v.NodeID,
			Name:          v.Name,
			Chain:         v.Chain,
			Region:        v.Region,
			Country:       v.Country,
			IsActive:      v.IsActive,
			IsValidator:   v.IsValidator,
			UptimePercent: v.UptimePercent,
			LastHeartbeat: v.LastHeartbeat,
		}
	}

	c.JSON(http.StatusOK, NodeListResponse{
		Nodes:    summaries,
		Total:    total,
		Active:   total,
		Page:     page,
		PageSize: pageSize,
	})
}

func listContracts(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	contractType := c.Query("type")
	verifiedOnly := c.DefaultQuery("verified", "false") == "true"

	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 50 {
		pageSize = 20
	}

	offset := (page - 1) * pageSize

	query := db.DB.Model(&models.ExplorerContract{}).Where("chain = ?", "solana")
	if contractType != "" {
		query = query.Where("contract_type = ?", contractType)
	}
	if verifiedOnly {
		query = query.Where("is_verified = ?", true)
	}

	var total int64
	query.Count(&total)

	var contracts []models.ExplorerContract
	if err := query.Order("total_calls DESC").Offset(offset).Limit(pageSize).Find(&contracts).Error; err != nil {
		logging.Error(err).Msg("[ProxyExplorer] Database query failed for listContracts")
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Proxy Explorer: Failed to fetch contracts",
			"details": err.Error(),
		})
		return
	}

	summaries := make([]ContractSummary, len(contracts))
	for i, ct := range contracts {
		summaries[i] = ContractSummary{
			Address:      ct.Address,
			Chain:        ct.Chain,
			Name:         ct.Name,
			ContractType: ct.ContractType,
			IsVerified:   ct.IsVerified,
			TotalCalls:   ct.TotalCalls,
			DeployedAt:   ct.DeployedAt,
		}
	}

	c.JSON(http.StatusOK, ContractListResponse{
		Contracts: summaries,
		Total:     total,
		Page:      page,
		PageSize:  pageSize,
	})
}

func getContractDetails(c *gin.Context) {
	address := c.Param("address")

	var contract models.ExplorerContract
	if err := db.DB.Where("address = ?", address).First(&contract).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Contract not found"})
		return
	}

	c.JSON(http.StatusOK, contract)
}

func getBandwidthStats(c *gin.Context) {
	period := c.DefaultQuery("period", "24h")

	var since time.Time
	switch period {
	case "1h":
		since = time.Now().Add(-1 * time.Hour)
	case "24h":
		since = time.Now().Add(-24 * time.Hour)
	case "7d":
		since = time.Now().Add(-7 * 24 * time.Hour)
	case "30d":
		since = time.Now().Add(-30 * 24 * time.Hour)
	default:
		since = time.Now().Add(-24 * time.Hour)
	}

	// Aggregate bandwidth from nodes
	var totalBandwidth uint64
	db.DB.Model(&models.ExplorerNode{}).Select("COALESCE(SUM(total_bandwidth), 0)").Scan(&totalBandwidth)

	// Get recent bandwidth (simplified - would aggregate from usage records in production)
	var recentBandwidth uint64
	db.DB.Model(&models.ExplorerNode{}).
		Where("last_heartbeat > ?", since).
		Select("COALESCE(SUM(total_bandwidth), 0)").
		Scan(&recentBandwidth)

	// Active connections count
	var activeConnections int64
	db.DB.Model(&models.ExplorerNode{}).
		Where("is_active = ? AND active_sessions > 0", true).
		Select("COALESCE(SUM(active_sessions), 0)").
		Scan(&activeConnections)

	// Bandwidth by region
	type RegionBW struct {
		Region    string  `json:"region"`
		Bandwidth float64 `json:"bandwidth"`
	}
	var regionStats []RegionBW
	db.DB.Model(&models.ExplorerNode{}).
		Select("region, SUM(total_bandwidth) as bandwidth").
		Group("region").
		Scan(&regionStats)

	bandwidthByRegion := make(map[string]float64)
	for _, r := range regionStats {
		bandwidthByRegion[r.Region] = r.Bandwidth / (1024 * 1024 * 1024)
	}

	// Top providers
	var topProviders []models.ExplorerNode
	db.DB.Order("total_bandwidth DESC").Limit(10).Find(&topProviders)

	providerStats := make([]ProviderBWStats, len(topProviders))
	for i, p := range topProviders {
		providerStats[i] = ProviderBWStats{
			NodeID:       p.NodeID,
			BandwidthGB:  float64(p.TotalBandwidth) / (1024 * 1024 * 1024),
			SessionCount: p.ActiveSessions,
		}
	}

	c.JSON(http.StatusOK, BandwidthStatsResponse{
		TotalBandwidthGB:     float64(totalBandwidth) / (1024 * 1024 * 1024),
		Last24HoursBandwidth: float64(recentBandwidth) / (1024 * 1024 * 1024),
		ActiveConnections:    activeConnections,
		BandwidthByRegion:    bandwidthByRegion,
		TopProviders:         providerStats,
	})
}

func getNetworkHealth(c *gin.Context) {
	health := NetworkHealthResponse{
		Status:      "healthy",
		LastChecked: time.Now(),
	}

	// Check Solana (simplified health check)
	// In production, this would ping the Solana RPC endpoint
	if os.Getenv("SOLANA_RPC_ENDPOINT") != "" {
		health.SolanaHealth = "healthy"
	} else {
		health.SolanaHealth = "unavailable"
	}

	// Check Database
	sqlDB, err := db.DB.DB()
	if err == nil {
		if err = sqlDB.Ping(); err == nil {
			health.DatabaseHealth = "healthy"
		} else {
			health.DatabaseHealth = "down"
			health.Status = "degraded"
		}
	} else {
		health.DatabaseHealth = "down"
		health.Status = "down"
	}

	// Active nodes
	db.DB.Model(&models.ExplorerNode{}).Where("is_active = ?", true).Count(&health.ActiveNodes)

	c.JSON(http.StatusOK, health)
}
