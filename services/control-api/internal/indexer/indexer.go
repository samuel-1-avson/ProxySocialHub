package indexer

import (
	"context"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/proxyhubb/control-api/internal/config"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
)

// ProviderRegistryABI is a minimal ABI for parsing the ProviderRegistered event
const ProviderRegistryABI = `[{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"provider","type":"address"},{"indexed":false,"internalType":"string","name":"metadataURI","type":"string"}],"name":"ProviderRegistered","type":"event"}]`

type Indexer struct {
	client          *ethclient.Client
	registryAddress common.Address
	contractABI     abi.ABI
}

func NewIndexer(cfg *config.Config) (*Indexer, error) {
	client, err := ethclient.Dial(cfg.Blockchain.EthRPC)
	if err != nil {
		return nil, err
	}

	parsedABI, err := abi.JSON(strings.NewReader(ProviderRegistryABI))
	if err != nil {
		return nil, err
	}

	// Validate address format
	if !common.IsHexAddress(cfg.Blockchain.RegistryAddress) {
		logging.Warn().Msg("Registry Contract Address is invalid or empty. Indexer disabled.")
		return nil, nil
	}

	return &Indexer{
		client:          client,
		registryAddress: common.HexToAddress(cfg.Blockchain.RegistryAddress),
		contractABI:     parsedABI,
	}, nil
}

func (i *Indexer) Start(ctx context.Context) {
	if i == nil {
		return
	}
	logging.Info().Str("contract", i.registryAddress.Hex()).Msg("Starting Event Indexer...")

	query := ethereum.FilterQuery{
		Addresses: []common.Address{i.registryAddress},
		Topics: [][]common.Hash{{
			crypto.Keccak256Hash([]byte("ProviderRegistered(address,string)")),
		}},
	}

	logs := make(chan types.Log)
	sub, err := i.client.SubscribeFilterLogs(ctx, query, logs)
	if err != nil {
		logging.Error(err).Msg("Failed to subscribe to logs. Retrying...")
		go i.retrySubscribe(ctx, query, logs)
		return
	}

	go func() {
		defer sub.Unsubscribe()
		for {
			select {
			case <-ctx.Done():
				return
			case err := <-sub.Err():
				logging.Error(err).Msg("Log subscription error")
				time.Sleep(5 * time.Second)
				go i.retrySubscribe(ctx, query, logs)
				return
			case vLog := <-logs:
				i.processLog(vLog)
			}
		}
	}()
}

func (i *Indexer) retrySubscribe(ctx context.Context, query ethereum.FilterQuery, logs chan types.Log) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
			sub, err := i.client.SubscribeFilterLogs(ctx, query, logs)
			if err == nil {
				logging.Info().Msg("Resubscribed to logs successfully")
				go func() {
					defer sub.Unsubscribe()
					for {
						select {
						case <-ctx.Done():
							return
						case err := <-sub.Err():
							logging.Error(err).Msg("Log subscription error")
							time.Sleep(5 * time.Second)
							go i.retrySubscribe(ctx, query, logs)
							return
						case vLog := <-logs:
							i.processLog(vLog)
						}
					}
				}()
				return
			}
			time.Sleep(5 * time.Second)
		}
	}
}

func (i *Indexer) processLog(vLog types.Log) {
	if len(vLog.Topics) < 2 {
		return
	}

	providerAddr := common.HexToAddress(vLog.Topics[1].Hex())

	var event struct {
		MetadataURI string
	}
	err := i.contractABI.UnpackIntoInterface(&event, "ProviderRegistered", vLog.Data)
	if err != nil {
		logging.Error(err).Msg("Failed to unpack log data")
		return
	}

	logging.Info().
		Str("provider", providerAddr.Hex()).
		Str("metadata_uri", event.MetadataURI).
		Msg("On-chain Provider Registration Detected")

	// Sync to DB
	var user models.User
	// Find user by WalletAddress (case-insensitive)
	if err := db.DB.Where("LOWER(wallet_address) = LOWER(?)", providerAddr.Hex()).First(&user).Error; err != nil {
		logging.Warn().
			Str("wallet", providerAddr.Hex()).
			Msg("Provider registered on-chain but User not found in DB with this wallet.")
		return
	}

	// Update User Role to 'provider' and set Verified
	updates := map[string]interface{}{
		"role":           "provider",
		"verified":       true,
		"trust_tier":     models.TrustTierVerified,
		"provider_since": time.Now(),
	}

	if err := db.DB.Model(&user).Updates(updates).Error; err != nil {
		logging.Error(err).Str("user_id", user.ID.String()).Msg("Failed to update User role after on-chain registration")
	} else {
		logging.Info().Str("user_id", user.ID.String()).Msg("User upgraded to Provider via on-chain event syncer")
	}
}
