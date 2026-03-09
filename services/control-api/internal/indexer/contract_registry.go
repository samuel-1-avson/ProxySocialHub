package indexer

import (
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
)

// ContractRegistry manages smart contract registration in the explorer
type ContractRegistry struct {
	db *gorm.DB
}

// ContractInfo holds information about a contract to register
type ContractInfo struct {
	Address         string
	Chain           string
	Name            string
	ContractType    string
	DeployTxHash    string
	DeployerAddress string
	SourceCodeHash  string
}

// NewContractRegistry creates a new contract registry
func NewContractRegistry() *ContractRegistry {
	return &ContractRegistry{
		db: db.DB,
	}
}

// RegisterContract registers a new contract in the explorer
func (cr *ContractRegistry) RegisterContract(info ContractInfo) error {
	// Check if contract already exists
	var existing models.ExplorerContract
	err := cr.db.Where("address = ?", info.Address).First(&existing).Error
	if err == nil {
		// Contract already exists, update if needed
		logging.Debug().Str("address", info.Address).Msg("[ContractRegistry] Contract already registered")
		return nil
	}

	if err != gorm.ErrRecordNotFound {
		return err
	}

	// Create new contract record
	contract := models.ExplorerContract{
		ID:              uuid.New(),
		Address:         info.Address,
		Chain:           info.Chain,
		Name:            info.Name,
		ContractType:    info.ContractType,
		DeployTxHash:    info.DeployTxHash,
		DeployerAddress: info.DeployerAddress,
		SourceCodeHash:  info.SourceCodeHash,
		IsVerified:      info.SourceCodeHash != "",
		TotalCalls:      0,
		TotalVolume:     0,
		DeployedAt:      time.Now(),
	}

	if err := cr.db.Create(&contract).Error; err != nil {
		return err
	}

	logging.Info().
		Str("address", info.Address).
		Str("name", info.Name).
		Str("type", info.ContractType).
		Msg("[ContractRegistry] Contract registered")

	return nil
}

// RegisterProxyHubbContracts registers the main ProxyHubb contracts
func (cr *ContractRegistry) RegisterProxyHubbContracts(programID string, treasuryAddress string) error {
	contracts := []ContractInfo{
		{
			Address:         programID,
			Chain:           "solana",
			Name:            "ProxyHubb Program",
			ContractType:    "program",
			DeployTxHash:    "",
			DeployerAddress: "",
			SourceCodeHash:  "",
		},
		{
			Address:         treasuryAddress,
			Chain:           "solana",
			Name:            "ProxyHubb Treasury",
			ContractType:    "treasury",
			DeployTxHash:    "",
			DeployerAddress: "",
			SourceCodeHash:  "",
		},
	}

	for _, contract := range contracts {
		if contract.Address == "" {
			continue
		}
		if err := cr.RegisterContract(contract); err != nil {
			logging.Error(err).Str("address", contract.Address).Msg("[ContractRegistry] Failed to register contract")
		}
	}

	return nil
}

// UpdateContractCalls updates the call count for a contract
func (cr *ContractRegistry) UpdateContractCalls(address string, callIncrement uint64, volume float64) error {
	return cr.db.Model(&models.ExplorerContract{}).
		Where("address = ?", address).
		Updates(map[string]interface{}{
			"total_calls":  gorm.Expr("total_calls + ?", callIncrement),
			"total_volume": gorm.Expr("total_volume + ?", volume),
		}).Error
}

// VerifyContract marks a contract as verified
func (cr *ContractRegistry) VerifyContract(address string, sourceCodeHash string) error {
	return cr.db.Model(&models.ExplorerContract{}).
		Where("address = ?", address).
		Updates(map[string]interface{}{
			"is_verified":      true,
			"source_code_hash": sourceCodeHash,
		}).Error
}

// GetContract returns contract details
func (cr *ContractRegistry) GetContract(address string) (*models.ExplorerContract, error) {
	var contract models.ExplorerContract
	if err := cr.db.Where("address = ?", address).First(&contract).Error; err != nil {
		return nil, err
	}
	return &contract, nil
}

// ListContracts returns a list of all registered contracts
func (cr *ContractRegistry) ListContracts(limit int) ([]models.ExplorerContract, error) {
	var contracts []models.ExplorerContract
	if err := cr.db.Limit(limit).Order("total_calls DESC").Find(&contracts).Error; err != nil {
		return nil, err
	}
	return contracts, nil
}

// AutoRegisterFromTransactions scans transactions and auto-registers unknown contracts
func (cr *ContractRegistry) AutoRegisterFromTransactions() error {
	// Find unique program IDs from transactions that aren't registered
	var programIDs []string

	err := cr.db.Model(&models.ExplorerTransaction{}).
		Select("DISTINCT program_id").
		Where("program_id != ?", "").
		Pluck("program_id", &programIDs).Error

	if err != nil {
		return err
	}

	for _, programID := range programIDs {
		// Check if already registered
		var count int64
		cr.db.Model(&models.ExplorerContract{}).Where("address = ?", programID).Count(&count)
		if count > 0 {
			continue
		}

		// Auto-register as unknown program
		if err := cr.RegisterContract(ContractInfo{
			Address:      programID,
			Chain:        "solana",
			Name:         "Unknown Program",
			ContractType: "program",
		}); err != nil {
			logging.Error(err).Str("program", programID).Msg("[ContractRegistry] Auto-registration failed")
		}
	}

	return nil
}
