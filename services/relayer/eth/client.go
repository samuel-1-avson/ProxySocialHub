package eth

import (
	"context"
	"crypto/ecdsa"
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/proxyhubb/relayer/eth/bindings"
)

type Client struct {
	ethClient       *ethclient.Client
	contract        *bindings.Bindings
	privateKey      *ecdsa.PrivateKey
	publicKey       common.Address
	contractAddress common.Address
	chainID         *big.Int
}

// SignClaim generates the ECDSA signature required by the contract
func SignClaim(oracleKey *ecdsa.PrivateKey, buyer, provider common.Address, bytesUsed, nonce *big.Int) ([]byte, error) {
	// Replicate Solidity: keccak256(abi.encodePacked(_buyer, _provider, _bytesUsed, _nonce))
	// Go encoding...

	// Packed encoding manual construction:
	// address (20) + address (20) + uint256 (32) + uint256 (32)
	data := make([]byte, 0, 20+20+32+32)
	data = append(data, buyer.Bytes()...)
	data = append(data, provider.Bytes()...)
	data = append(data, common.LeftPadBytes(bytesUsed.Bytes(), 32)...)
	data = append(data, common.LeftPadBytes(nonce.Bytes(), 32)...)

	hash := crypto.Keccak256(data)

	// Corresponds to: getEthSignedMessageHash
	// "\x19Ethereum Signed Message:\n32" + hash
	prefix := []byte(fmt.Sprintf("\x19Ethereum Signed Message:\n%d", len(hash)))
	prefixedHash := append(prefix, hash...)
	ethHash := crypto.Keccak256(prefixedHash)

	signature, err := crypto.Sign(ethHash, oracleKey)
	if err != nil {
		return nil, err
	}
	// Adjust V (0/1 -> 27/28)
	if signature[64] < 27 {
		signature[64] += 27
	}
	return signature, nil
}

func NewClient(rpcUrl, privateKeyHex, contractAddrHex string) (*Client, error) {
	client, err := ethclient.Dial(rpcUrl)
	if err != nil {
		return nil, fmt.Errorf("dial failed: %w", err)
	}

	// Parse Private Key
	privateKey, err := crypto.HexToECDSA(privateKeyHex)
	if err != nil {
		return nil, fmt.Errorf("invalid private key: %w", err)
	}

	publicKey := crypto.PubkeyToAddress(privateKey.PublicKey)
	contractAddress := common.HexToAddress(contractAddrHex)

	// Bind Contract
	instance, err := bindings.NewBindings(contractAddress, client)
	if err != nil {
		return nil, fmt.Errorf("failed to bind contract: %w", err)
	}

	chainID, err := client.ChainID(context.Background())
	if err != nil {
		return nil, fmt.Errorf("failed to get chainID: %w", err)
	}

	return &Client{
		ethClient:       client,
		contract:        instance,
		privateKey:      privateKey,
		publicKey:       publicKey,
		contractAddress: contractAddress,
		chainID:         chainID,
	}, nil
}

// GetTransactor returns a new keyed transactor for signing transactions
func (c *Client) GetTransactor() (*bind.TransactOpts, error) {
	auth, err := bind.NewKeyedTransactorWithChainID(c.privateKey, c.chainID)
	if err != nil {
		return nil, err
	}
	// Recommended: Get current nonce and suggested gas price
	nonce, err := c.ethClient.PendingNonceAt(context.Background(), c.publicKey)
	if err != nil {
		return nil, err
	}
	auth.Nonce = big.NewInt(int64(nonce))
	auth.Value = big.NewInt(0) // in wei

	// auth.GasLimit = uint64(300000) // in units - let estimation handle it?
	// auth.GasPrice = ...

	return auth, nil
}

// ClaimEarningsFor calls the smart contract on behalf of a provider
func (c *Client) ClaimEarningsFor(buyer, provider common.Address, bytesUsed *big.Int, nonce *big.Int, signature []byte) (string, error) {
	opts, err := c.GetTransactor()
	if err != nil {
		return "", err
	}

	tx, err := c.contract.ClaimEarningsFor(opts, buyer, provider, bytesUsed, nonce, signature)
	if err != nil {
		return "", fmt.Errorf("claim tx failed: %w", err)
	}

	return tx.Hash().Hex(), nil
}

// WithdrawEarningsFor calls the smart contract to push funds to a provider
func (c *Client) WithdrawEarningsFor(provider common.Address) (string, error) {
	opts, err := c.GetTransactor()
	if err != nil {
		return "", err
	}

	tx, err := c.contract.WithdrawEarningsFor(opts, provider)
	if err != nil {
		return "", fmt.Errorf("withdraw tx failed: %w", err)
	}

	return tx.Hash().Hex(), nil
}

// Address returns the client's wallet address
func (c *Client) Address() common.Address {
	return c.publicKey
}

// PrivateKey returns the client's private key (for signing messages)
func (c *Client) PrivateKey() *ecdsa.PrivateKey {
	return c.privateKey
}

// GetPricePerGB fetches the current price per GB from the contract
func (c *Client) GetPricePerGB() (*big.Int, error) {
	return c.contract.PricePerGB(nil)
}

// Deposit funds into the contract for the caller (Relayer Treasury)
func (c *Client) Deposit(amountEth *big.Int) (string, error) {
	opts, err := c.GetTransactor()
	if err != nil {
		return "", err
	}
	opts.Value = amountEth // Set value to send

	tx, err := c.contract.Deposit(opts)
	if err != nil {
		return "", fmt.Errorf("deposit failed: %w", err)
	}
	return tx.Hash().Hex(), nil
}
