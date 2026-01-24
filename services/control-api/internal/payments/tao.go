package payments

import (
	"fmt"

	"github.com/proxyhubb/control-api/internal/bittensor"
)

// TaoClient handles TAO payments using the connection to the Bittensor Bridge
type TaoClient struct {
	btClient *bittensor.Client
}

func NewTaoClient(client *bittensor.Client) *TaoClient {
	return &TaoClient{
		btClient: client,
	}
}

// DepositAddress returns the address where users should send TAO
// For this Phase, we use a single centralized coldkey and rely on Memo or sender tracking
// Ideally, generate a unique address per user, but for now we return the bridge's default wallet address.
func (c *TaoClient) GetDepositAddress() (string, error) {
	// Call bridge to get current wallet info
	wallet, err := c.btClient.GetWallet("default", "default")
	if err != nil {
		return "", err
	}
	return wallet.ColdkeySS58, nil
}

// VerifyDeposit checks if a transaction hash corresponds to a valid deposit
func (c *TaoClient) VerifyDeposit(txHash string, expectedAmount float64) (bool, error) {
	// Logic:
	// 1. Call bridge /transaction/{hash}
	// 2. Parsed amount == expectedAmount
	// 3. Status == Confirmed/Finalized

	// Since bridge implementation is mocked:
	// We assume if txHash starts with "0xvalid", it's good.
	// In production, MUST implement block scanning.

	if txHash == "0x_mock_deposit" {
		return true, nil
	}

	return false, fmt.Errorf("transaction verification not implemented fully")
}

// Transfer sends TAO from our hot wallet to a recipient
func (c *TaoClient) Transfer(recipient string, amount float64) error {
	// Using default wallet to send
	return c.btClient.TransferTAO("default", "default", recipient, amount)
}

// StartFaucet triggers the background PoW mining
func (c *TaoClient) StartFaucet(walletName, hotkey string) (*bittensor.FaucetResponse, error) {
	return c.btClient.StartFaucet(walletName, hotkey)
}

// GetFaucetStatus returns the current status of the faucet worker
func (c *TaoClient) GetFaucetStatus() (*bittensor.FaucetStatusResponse, error) {
	return c.btClient.GetFaucetStatus()
}
