// Code generated - DO NOT EDIT.
// This file is a generated binding and any manual changes will be lost.

package bindings

import (
	"errors"
	"math/big"
	"strings"

	ethereum "github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/event"
)

// Reference imports to suppress errors if they are not otherwise used.
var (
	_ = errors.New
	_ = big.NewInt
	_ = strings.NewReader
	_ = ethereum.NotFound
	_ = bind.Bind
	_ = common.Big1
	_ = types.BloomLookup
	_ = event.NewSubscription
	_ = abi.ConvertType
)

// BindingsMetaData contains all meta data concerning the Bindings contract.
var BindingsMetaData = &bind.MetaData{
	ABI: "[{\"inputs\":[{\"internalType\":\"address\",\"name\":\"_oracleAddress\",\"type\":\"address\"}],\"stateMutability\":\"nonpayable\",\"type\":\"constructor\"},{\"inputs\":[{\"internalType\":\"address\",\"name\":\"owner\",\"type\":\"address\"}],\"name\":\"OwnableInvalidOwner\",\"type\":\"error\"},{\"inputs\":[{\"internalType\":\"address\",\"name\":\"account\",\"type\":\"address\"}],\"name\":\"OwnableUnauthorizedAccount\",\"type\":\"error\"},{\"inputs\":[],\"name\":\"ReentrancyGuardReentrantCall\",\"type\":\"error\"},{\"anonymous\":false,\"inputs\":[{\"indexed\":true,\"internalType\":\"address\",\"name\":\"buyer\",\"type\":\"address\"},{\"indexed\":false,\"internalType\":\"uint256\",\"name\":\"amount\",\"type\":\"uint256\"}],\"name\":\"Deposit\",\"type\":\"event\"},{\"anonymous\":false,\"inputs\":[{\"indexed\":true,\"internalType\":\"address\",\"name\":\"previousOwner\",\"type\":\"address\"},{\"indexed\":true,\"internalType\":\"address\",\"name\":\"newOwner\",\"type\":\"address\"}],\"name\":\"OwnershipTransferred\",\"type\":\"event\"},{\"anonymous\":false,\"inputs\":[{\"indexed\":true,\"internalType\":\"address\",\"name\":\"provider\",\"type\":\"address\"},{\"indexed\":true,\"internalType\":\"address\",\"name\":\"buyer\",\"type\":\"address\"},{\"indexed\":false,\"internalType\":\"uint256\",\"name\":\"amount\",\"type\":\"uint256\"},{\"indexed\":false,\"internalType\":\"uint256\",\"name\":\"bytesUsed\",\"type\":\"uint256\"}],\"name\":\"UsageSettled\",\"type\":\"event\"},{\"anonymous\":false,\"inputs\":[{\"indexed\":true,\"internalType\":\"address\",\"name\":\"user\",\"type\":\"address\"},{\"indexed\":false,\"internalType\":\"uint256\",\"name\":\"amount\",\"type\":\"uint256\"}],\"name\":\"Withdrawal\",\"type\":\"event\"},{\"inputs\":[{\"internalType\":\"address\",\"name\":\"\",\"type\":\"address\"}],\"name\":\"buyerDeposits\",\"outputs\":[{\"internalType\":\"uint256\",\"name\":\"\",\"type\":\"uint256\"}],\"stateMutability\":\"view\",\"type\":\"function\"},{\"inputs\":[{\"internalType\":\"address\",\"name\":\"_buyer\",\"type\":\"address\"},{\"internalType\":\"uint256\",\"name\":\"_bytesUsed\",\"type\":\"uint256\"},{\"internalType\":\"uint256\",\"name\":\"_nonce\",\"type\":\"uint256\"},{\"internalType\":\"bytes\",\"name\":\"_signature\",\"type\":\"bytes\"}],\"name\":\"claimEarnings\",\"outputs\":[],\"stateMutability\":\"nonpayable\",\"type\":\"function\"},{\"inputs\":[{\"internalType\":\"address\",\"name\":\"_buyer\",\"type\":\"address\"},{\"internalType\":\"address\",\"name\":\"_provider\",\"type\":\"address\"},{\"internalType\":\"uint256\",\"name\":\"_bytesUsed\",\"type\":\"uint256\"},{\"internalType\":\"uint256\",\"name\":\"_nonce\",\"type\":\"uint256\"},{\"internalType\":\"bytes\",\"name\":\"_signature\",\"type\":\"bytes\"}],\"name\":\"claimEarningsFor\",\"outputs\":[],\"stateMutability\":\"nonpayable\",\"type\":\"function\"},{\"inputs\":[{\"internalType\":\"address\",\"name\":\"_provider\",\"type\":\"address\"}],\"name\":\"withdrawEarningsFor\",\"outputs\":[],\"stateMutability\":\"nonpayable\",\"type\":\"function\"},{\"inputs\":[],\"name\":\"deposit\",\"outputs\":[],\"stateMutability\":\"payable\",\"type\":\"function\"},{\"inputs\":[{\"internalType\":\"bytes32\",\"name\":\"_messageHash\",\"type\":\"bytes32\"}],\"name\":\"getEthSignedMessageHash\",\"outputs\":[{\"internalType\":\"bytes32\",\"name\":\"\",\"type\":\"bytes32\"}],\"stateMutability\":\"pure\",\"type\":\"function\"},{\"inputs\":[],\"name\":\"oracleAddress\",\"outputs\":[{\"internalType\":\"address\",\"name\":\"\",\"type\":\"address\"}],\"stateMutability\":\"view\",\"type\":\"function\"},{\"inputs\":[],\"name\":\"owner\",\"outputs\":[{\"internalType\":\"address\",\"name\":\"\",\"type\":\"address\"}],\"stateMutability\":\"view\",\"type\":\"function\"},{\"inputs\":[],\"name\":\"pricePerGB\",\"outputs\":[{\"internalType\":\"uint256\",\"name\":\"\",\"type\":\"uint256\"}],\"stateMutability\":\"view\",\"type\":\"function\"},{\"inputs\":[{\"internalType\":\"bytes32\",\"name\":\"\",\"type\":\"bytes32\"}],\"name\":\"processedNonces\",\"outputs\":[{\"internalType\":\"bool\",\"name\":\"\",\"type\":\"bool\"}],\"stateMutability\":\"view\",\"type\":\"function\"},{\"inputs\":[{\"internalType\":\"address\",\"name\":\"\",\"type\":\"address\"}],\"name\":\"providerBalances\",\"outputs\":[{\"internalType\":\"uint256\",\"name\":\"\",\"type\":\"uint256\"}],\"stateMutability\":\"view\",\"type\":\"function\"},{\"inputs\":[{\"internalType\":\"bytes32\",\"name\":\"_ethSignedMessageHash\",\"type\":\"bytes32\"},{\"internalType\":\"bytes\",\"name\":\"_signature\",\"type\":\"bytes\"}],\"name\":\"recoverSigner\",\"outputs\":[{\"internalType\":\"address\",\"name\":\"\",\"type\":\"address\"}],\"stateMutability\":\"pure\",\"type\":\"function\"},{\"inputs\":[],\"name\":\"renounceOwnership\",\"outputs\":[],\"stateMutability\":\"nonpayable\",\"type\":\"function\"},{\"inputs\":[{\"internalType\":\"address\",\"name\":\"_oracle\",\"type\":\"address\"}],\"name\":\"setOracle\",\"outputs\":[],\"stateMutability\":\"nonpayable\",\"type\":\"function\"},{\"inputs\":[{\"internalType\":\"uint256\",\"name\":\"_price\",\"type\":\"uint256\"}],\"name\":\"setPricePerGB\",\"outputs\":[],\"stateMutability\":\"nonpayable\",\"type\":\"function\"},{\"inputs\":[{\"internalType\":\"bytes\",\"name\":\"sig\",\"type\":\"bytes\"}],\"name\":\"splitSignature\",\"outputs\":[{\"internalType\":\"bytes32\",\"name\":\"r\",\"type\":\"bytes32\"},{\"internalType\":\"bytes32\",\"name\":\"s\",\"type\":\"bytes32\"},{\"internalType\":\"uint8\",\"name\":\"v\",\"type\":\"uint8\"}],\"stateMutability\":\"pure\",\"type\":\"function\"},{\"inputs\":[{\"internalType\":\"address\",\"name\":\"newOwner\",\"type\":\"address\"}],\"name\":\"transferOwnership\",\"outputs\":[],\"stateMutability\":\"nonpayable\",\"type\":\"function\"},{\"inputs\":[{\"internalType\":\"uint256\",\"name\":\"_amount\",\"type\":\"uint256\"}],\"name\":\"withdrawDeposit\",\"outputs\":[],\"stateMutability\":\"nonpayable\",\"type\":\"function\"},{\"inputs\":[],\"name\":\"withdrawEarnings\",\"outputs\":[],\"stateMutability\":\"nonpayable\",\"type\":\"function\"}]",
}

// BindingsABI is the input ABI used to generate the binding from.
// Deprecated: Use BindingsMetaData.ABI instead.
var BindingsABI = BindingsMetaData.ABI

// Bindings is an auto generated Go binding around an Ethereum contract.
type Bindings struct {
	BindingsCaller     // Read-only binding to the contract
	BindingsTransactor // Write-only binding to the contract
	BindingsFilterer   // Log filterer for contract events
}

// BindingsCaller is an auto generated read-only Go binding around an Ethereum contract.
type BindingsCaller struct {
	contract *bind.BoundContract // Generic contract wrapper for the low level calls
}

// BindingsTransactor is an auto generated write-only Go binding around an Ethereum contract.
type BindingsTransactor struct {
	contract *bind.BoundContract // Generic contract wrapper for the low level calls
}

// BindingsFilterer is an auto generated log filtering Go binding around an Ethereum contract events.
type BindingsFilterer struct {
	contract *bind.BoundContract // Generic contract wrapper for the low level calls
}

// BindingsSession is an auto generated Go binding around an Ethereum contract,
// with pre-set call and transact options.
type BindingsSession struct {
	Contract     *Bindings         // Generic contract binding to set the session for
	CallOpts     bind.CallOpts     // Call options to use throughout this session
	TransactOpts bind.TransactOpts // Transaction auth options to use throughout this session
}

// BindingsCallerSession is an auto generated read-only Go binding around an Ethereum contract,
// with pre-set call options.
type BindingsCallerSession struct {
	Contract *BindingsCaller // Generic contract caller binding to set the session for
	CallOpts bind.CallOpts   // Call options to use throughout this session
}

// BindingsTransactorSession is an auto generated write-only Go binding around an Ethereum contract,
// with pre-set transact options.
type BindingsTransactorSession struct {
	Contract     *BindingsTransactor // Generic contract transactor binding to set the session for
	TransactOpts bind.TransactOpts   // Transaction auth options to use throughout this session
}

// BindingsRaw is an auto generated low-level Go binding around an Ethereum contract.
type BindingsRaw struct {
	Contract *Bindings // Generic contract binding to access the raw methods on
}

// BindingsCallerRaw is an auto generated low-level read-only Go binding around an Ethereum contract.
type BindingsCallerRaw struct {
	Contract *BindingsCaller // Generic read-only contract binding to access the raw methods on
}

// BindingsTransactorRaw is an auto generated low-level write-only Go binding around an Ethereum contract.
type BindingsTransactorRaw struct {
	Contract *BindingsTransactor // Generic write-only contract binding to access the raw methods on
}

// NewBindings creates a new instance of Bindings, bound to a specific deployed contract.
func NewBindings(address common.Address, backend bind.ContractBackend) (*Bindings, error) {
	contract, err := bindBindings(address, backend, backend, backend)
	if err != nil {
		return nil, err
	}
	return &Bindings{BindingsCaller: BindingsCaller{contract: contract}, BindingsTransactor: BindingsTransactor{contract: contract}, BindingsFilterer: BindingsFilterer{contract: contract}}, nil
}

// NewBindingsCaller creates a new read-only instance of Bindings, bound to a specific deployed contract.
func NewBindingsCaller(address common.Address, caller bind.ContractCaller) (*BindingsCaller, error) {
	contract, err := bindBindings(address, caller, nil, nil)
	if err != nil {
		return nil, err
	}
	return &BindingsCaller{contract: contract}, nil
}

// NewBindingsTransactor creates a new write-only instance of Bindings, bound to a specific deployed contract.
func NewBindingsTransactor(address common.Address, transactor bind.ContractTransactor) (*BindingsTransactor, error) {
	contract, err := bindBindings(address, nil, transactor, nil)
	if err != nil {
		return nil, err
	}
	return &BindingsTransactor{contract: contract}, nil
}

// NewBindingsFilterer creates a new log filterer instance of Bindings, bound to a specific deployed contract.
func NewBindingsFilterer(address common.Address, filterer bind.ContractFilterer) (*BindingsFilterer, error) {
	contract, err := bindBindings(address, nil, nil, filterer)
	if err != nil {
		return nil, err
	}
	return &BindingsFilterer{contract: contract}, nil
}

// bindBindings binds a generic wrapper to an already deployed contract.
func bindBindings(address common.Address, caller bind.ContractCaller, transactor bind.ContractTransactor, filterer bind.ContractFilterer) (*bind.BoundContract, error) {
	parsed, err := BindingsMetaData.GetAbi()
	if err != nil {
		return nil, err
	}
	return bind.NewBoundContract(address, *parsed, caller, transactor, filterer), nil
}

// Call invokes the (constant) contract method with params as input values and
// sets the output to result. The result type might be a single field for simple
// returns, a slice of interfaces for anonymous returns and a struct for named
// returns.
func (_Bindings *BindingsRaw) Call(opts *bind.CallOpts, result *[]interface{}, method string, params ...interface{}) error {
	return _Bindings.Contract.BindingsCaller.contract.Call(opts, result, method, params...)
}

// Transfer initiates a plain transaction to move funds to the contract, calling
// its default method if one is available.
func (_Bindings *BindingsRaw) Transfer(opts *bind.TransactOpts) (*types.Transaction, error) {
	return _Bindings.Contract.BindingsTransactor.contract.Transfer(opts)
}

// Transact invokes the (paid) contract method with params as input values.
func (_Bindings *BindingsRaw) Transact(opts *bind.TransactOpts, method string, params ...interface{}) (*types.Transaction, error) {
	return _Bindings.Contract.BindingsTransactor.contract.Transact(opts, method, params...)
}

// Call invokes the (constant) contract method with params as input values and
// sets the output to result. The result type might be a single field for simple
// returns, a slice of interfaces for anonymous returns and a struct for named
// returns.
func (_Bindings *BindingsCallerRaw) Call(opts *bind.CallOpts, result *[]interface{}, method string, params ...interface{}) error {
	return _Bindings.Contract.contract.Call(opts, result, method, params...)
}

// Transfer initiates a plain transaction to move funds to the contract, calling
// its default method if one is available.
func (_Bindings *BindingsTransactorRaw) Transfer(opts *bind.TransactOpts) (*types.Transaction, error) {
	return _Bindings.Contract.contract.Transfer(opts)
}

// Transact invokes the (paid) contract method with params as input values.
func (_Bindings *BindingsTransactorRaw) Transact(opts *bind.TransactOpts, method string, params ...interface{}) (*types.Transaction, error) {
	return _Bindings.Contract.contract.Transact(opts, method, params...)
}

// BuyerDeposits is a free data retrieval call binding the contract method 0x3fc0fd42.
//
// Solidity: function buyerDeposits(address ) view returns(uint256)
func (_Bindings *BindingsCaller) BuyerDeposits(opts *bind.CallOpts, arg0 common.Address) (*big.Int, error) {
	var out []interface{}
	err := _Bindings.contract.Call(opts, &out, "buyerDeposits", arg0)

	if err != nil {
		return *new(*big.Int), err
	}

	out0 := *abi.ConvertType(out[0], new(*big.Int)).(**big.Int)

	return out0, err

}

// BuyerDeposits is a free data retrieval call binding the contract method 0x3fc0fd42.
//
// Solidity: function buyerDeposits(address ) view returns(uint256)
func (_Bindings *BindingsSession) BuyerDeposits(arg0 common.Address) (*big.Int, error) {
	return _Bindings.Contract.BuyerDeposits(&_Bindings.CallOpts, arg0)
}

// BuyerDeposits is a free data retrieval call binding the contract method 0x3fc0fd42.
//
// Solidity: function buyerDeposits(address ) view returns(uint256)
func (_Bindings *BindingsCallerSession) BuyerDeposits(arg0 common.Address) (*big.Int, error) {
	return _Bindings.Contract.BuyerDeposits(&_Bindings.CallOpts, arg0)
}

// GetEthSignedMessageHash is a free data retrieval call binding the contract method 0xfa540801.
//
// Solidity: function getEthSignedMessageHash(bytes32 _messageHash) pure returns(bytes32)
func (_Bindings *BindingsCaller) GetEthSignedMessageHash(opts *bind.CallOpts, _messageHash [32]byte) ([32]byte, error) {
	var out []interface{}
	err := _Bindings.contract.Call(opts, &out, "getEthSignedMessageHash", _messageHash)

	if err != nil {
		return *new([32]byte), err
	}

	out0 := *abi.ConvertType(out[0], new([32]byte)).(*[32]byte)

	return out0, err

}

// GetEthSignedMessageHash is a free data retrieval call binding the contract method 0xfa540801.
//
// Solidity: function getEthSignedMessageHash(bytes32 _messageHash) pure returns(bytes32)
func (_Bindings *BindingsSession) GetEthSignedMessageHash(_messageHash [32]byte) ([32]byte, error) {
	return _Bindings.Contract.GetEthSignedMessageHash(&_Bindings.CallOpts, _messageHash)
}

// GetEthSignedMessageHash is a free data retrieval call binding the contract method 0xfa540801.
//
// Solidity: function getEthSignedMessageHash(bytes32 _messageHash) pure returns(bytes32)
func (_Bindings *BindingsCallerSession) GetEthSignedMessageHash(_messageHash [32]byte) ([32]byte, error) {
	return _Bindings.Contract.GetEthSignedMessageHash(&_Bindings.CallOpts, _messageHash)
}

// OracleAddress is a free data retrieval call binding the contract method 0xa89ae4ba.
//
// Solidity: function oracleAddress() view returns(address)
func (_Bindings *BindingsCaller) OracleAddress(opts *bind.CallOpts) (common.Address, error) {
	var out []interface{}
	err := _Bindings.contract.Call(opts, &out, "oracleAddress")

	if err != nil {
		return *new(common.Address), err
	}

	out0 := *abi.ConvertType(out[0], new(common.Address)).(*common.Address)

	return out0, err

}

// OracleAddress is a free data retrieval call binding the contract method 0xa89ae4ba.
//
// Solidity: function oracleAddress() view returns(address)
func (_Bindings *BindingsSession) OracleAddress() (common.Address, error) {
	return _Bindings.Contract.OracleAddress(&_Bindings.CallOpts)
}

// OracleAddress is a free data retrieval call binding the contract method 0xa89ae4ba.
//
// Solidity: function oracleAddress() view returns(address)
func (_Bindings *BindingsCallerSession) OracleAddress() (common.Address, error) {
	return _Bindings.Contract.OracleAddress(&_Bindings.CallOpts)
}

// Owner is a free data retrieval call binding the contract method 0x8da5cb5b.
//
// Solidity: function owner() view returns(address)
func (_Bindings *BindingsCaller) Owner(opts *bind.CallOpts) (common.Address, error) {
	var out []interface{}
	err := _Bindings.contract.Call(opts, &out, "owner")

	if err != nil {
		return *new(common.Address), err
	}

	out0 := *abi.ConvertType(out[0], new(common.Address)).(*common.Address)

	return out0, err

}

// Owner is a free data retrieval call binding the contract method 0x8da5cb5b.
//
// Solidity: function owner() view returns(address)
func (_Bindings *BindingsSession) Owner() (common.Address, error) {
	return _Bindings.Contract.Owner(&_Bindings.CallOpts)
}

// Owner is a free data retrieval call binding the contract method 0x8da5cb5b.
//
// Solidity: function owner() view returns(address)
func (_Bindings *BindingsCallerSession) Owner() (common.Address, error) {
	return _Bindings.Contract.Owner(&_Bindings.CallOpts)
}

// PricePerGB is a free data retrieval call binding the contract method 0x1cf30841.
//
// Solidity: function pricePerGB() view returns(uint256)
func (_Bindings *BindingsCaller) PricePerGB(opts *bind.CallOpts) (*big.Int, error) {
	var out []interface{}
	err := _Bindings.contract.Call(opts, &out, "pricePerGB")

	if err != nil {
		return *new(*big.Int), err
	}

	out0 := *abi.ConvertType(out[0], new(*big.Int)).(**big.Int)

	return out0, err

}

// PricePerGB is a free data retrieval call binding the contract method 0x1cf30841.
//
// Solidity: function pricePerGB() view returns(uint256)
func (_Bindings *BindingsSession) PricePerGB() (*big.Int, error) {
	return _Bindings.Contract.PricePerGB(&_Bindings.CallOpts)
}

// PricePerGB is a free data retrieval call binding the contract method 0x1cf30841.
//
// Solidity: function pricePerGB() view returns(uint256)
func (_Bindings *BindingsCallerSession) PricePerGB() (*big.Int, error) {
	return _Bindings.Contract.PricePerGB(&_Bindings.CallOpts)
}

// ProcessedNonces is a free data retrieval call binding the contract method 0x404a4edb.
//
// Solidity: function processedNonces(bytes32 ) view returns(bool)
func (_Bindings *BindingsCaller) ProcessedNonces(opts *bind.CallOpts, arg0 [32]byte) (bool, error) {
	var out []interface{}
	err := _Bindings.contract.Call(opts, &out, "processedNonces", arg0)

	if err != nil {
		return *new(bool), err
	}

	out0 := *abi.ConvertType(out[0], new(bool)).(*bool)

	return out0, err

}

// ProcessedNonces is a free data retrieval call binding the contract method 0x404a4edb.
//
// Solidity: function processedNonces(bytes32 ) view returns(bool)
func (_Bindings *BindingsSession) ProcessedNonces(arg0 [32]byte) (bool, error) {
	return _Bindings.Contract.ProcessedNonces(&_Bindings.CallOpts, arg0)
}

// ProcessedNonces is a free data retrieval call binding the contract method 0x404a4edb.
//
// Solidity: function processedNonces(bytes32 ) view returns(bool)
func (_Bindings *BindingsCallerSession) ProcessedNonces(arg0 [32]byte) (bool, error) {
	return _Bindings.Contract.ProcessedNonces(&_Bindings.CallOpts, arg0)
}

// ProviderBalances is a free data retrieval call binding the contract method 0x28ac7f2c.
//
// Solidity: function providerBalances(address ) view returns(uint256)
func (_Bindings *BindingsCaller) ProviderBalances(opts *bind.CallOpts, arg0 common.Address) (*big.Int, error) {
	var out []interface{}
	err := _Bindings.contract.Call(opts, &out, "providerBalances", arg0)

	if err != nil {
		return *new(*big.Int), err
	}

	out0 := *abi.ConvertType(out[0], new(*big.Int)).(**big.Int)

	return out0, err

}

// ProviderBalances is a free data retrieval call binding the contract method 0x28ac7f2c.
//
// Solidity: function providerBalances(address ) view returns(uint256)
func (_Bindings *BindingsSession) ProviderBalances(arg0 common.Address) (*big.Int, error) {
	return _Bindings.Contract.ProviderBalances(&_Bindings.CallOpts, arg0)
}

// ProviderBalances is a free data retrieval call binding the contract method 0x28ac7f2c.
//
// Solidity: function providerBalances(address ) view returns(uint256)
func (_Bindings *BindingsCallerSession) ProviderBalances(arg0 common.Address) (*big.Int, error) {
	return _Bindings.Contract.ProviderBalances(&_Bindings.CallOpts, arg0)
}

// RecoverSigner is a free data retrieval call binding the contract method 0x97aba7f9.
//
// Solidity: function recoverSigner(bytes32 _ethSignedMessageHash, bytes _signature) pure returns(address)
func (_Bindings *BindingsCaller) RecoverSigner(opts *bind.CallOpts, _ethSignedMessageHash [32]byte, _signature []byte) (common.Address, error) {
	var out []interface{}
	err := _Bindings.contract.Call(opts, &out, "recoverSigner", _ethSignedMessageHash, _signature)

	if err != nil {
		return *new(common.Address), err
	}

	out0 := *abi.ConvertType(out[0], new(common.Address)).(*common.Address)

	return out0, err

}

// RecoverSigner is a free data retrieval call binding the contract method 0x97aba7f9.
//
// Solidity: function recoverSigner(bytes32 _ethSignedMessageHash, bytes _signature) pure returns(address)
func (_Bindings *BindingsSession) RecoverSigner(_ethSignedMessageHash [32]byte, _signature []byte) (common.Address, error) {
	return _Bindings.Contract.RecoverSigner(&_Bindings.CallOpts, _ethSignedMessageHash, _signature)
}

// RecoverSigner is a free data retrieval call binding the contract method 0x97aba7f9.
//
// Solidity: function recoverSigner(bytes32 _ethSignedMessageHash, bytes _signature) pure returns(address)
func (_Bindings *BindingsCallerSession) RecoverSigner(_ethSignedMessageHash [32]byte, _signature []byte) (common.Address, error) {
	return _Bindings.Contract.RecoverSigner(&_Bindings.CallOpts, _ethSignedMessageHash, _signature)
}

// SplitSignature is a free data retrieval call binding the contract method 0xa7bb5803.
//
// Solidity: function splitSignature(bytes sig) pure returns(bytes32 r, bytes32 s, uint8 v)
func (_Bindings *BindingsCaller) SplitSignature(opts *bind.CallOpts, sig []byte) (struct {
	R [32]byte
	S [32]byte
	V uint8
}, error) {
	var out []interface{}
	err := _Bindings.contract.Call(opts, &out, "splitSignature", sig)

	outstruct := new(struct {
		R [32]byte
		S [32]byte
		V uint8
	})
	if err != nil {
		return *outstruct, err
	}

	outstruct.R = *abi.ConvertType(out[0], new([32]byte)).(*[32]byte)
	outstruct.S = *abi.ConvertType(out[1], new([32]byte)).(*[32]byte)
	outstruct.V = *abi.ConvertType(out[2], new(uint8)).(*uint8)

	return *outstruct, err

}

// SplitSignature is a free data retrieval call binding the contract method 0xa7bb5803.
//
// Solidity: function splitSignature(bytes sig) pure returns(bytes32 r, bytes32 s, uint8 v)
func (_Bindings *BindingsSession) SplitSignature(sig []byte) (struct {
	R [32]byte
	S [32]byte
	V uint8
}, error) {
	return _Bindings.Contract.SplitSignature(&_Bindings.CallOpts, sig)
}

// SplitSignature is a free data retrieval call binding the contract method 0xa7bb5803.
//
// Solidity: function splitSignature(bytes sig) pure returns(bytes32 r, bytes32 s, uint8 v)
func (_Bindings *BindingsCallerSession) SplitSignature(sig []byte) (struct {
	R [32]byte
	S [32]byte
	V uint8
}, error) {
	return _Bindings.Contract.SplitSignature(&_Bindings.CallOpts, sig)
}

// ClaimEarnings is a paid mutator transaction binding the contract method 0x5d936d3f.
//
// Solidity: function claimEarnings(address _buyer, uint256 _bytesUsed, uint256 _nonce, bytes _signature) returns()
func (_Bindings *BindingsTransactor) ClaimEarnings(opts *bind.TransactOpts, _buyer common.Address, _bytesUsed *big.Int, _nonce *big.Int, _signature []byte) (*types.Transaction, error) {
	return _Bindings.contract.Transact(opts, "claimEarnings", _buyer, _bytesUsed, _nonce, _signature)
}

// ClaimEarnings is a paid mutator transaction binding the contract method 0x5d936d3f.
//
// Solidity: function claimEarnings(address _buyer, uint256 _bytesUsed, uint256 _nonce, bytes _signature) returns()
func (_Bindings *BindingsSession) ClaimEarnings(_buyer common.Address, _bytesUsed *big.Int, _nonce *big.Int, _signature []byte) (*types.Transaction, error) {
	return _Bindings.Contract.ClaimEarnings(&_Bindings.TransactOpts, _buyer, _bytesUsed, _nonce, _signature)
}

// ClaimEarnings is a paid mutator transaction binding the contract method 0x5d936d3f.
//
// Solidity: function claimEarnings(address _buyer, uint256 _bytesUsed, uint256 _nonce, bytes _signature) returns()
func (_Bindings *BindingsTransactorSession) ClaimEarnings(_buyer common.Address, _bytesUsed *big.Int, _nonce *big.Int, _signature []byte) (*types.Transaction, error) {
	return _Bindings.Contract.ClaimEarnings(&_Bindings.TransactOpts, _buyer, _bytesUsed, _nonce, _signature)
}

// ClaimEarningsFor is a paid mutator transaction binding the contract method 0x862a02fd.
//
// Solidity: function claimEarningsFor(address _buyer, address _provider, uint256 _bytesUsed, uint256 _nonce, bytes _signature) returns()
func (_Bindings *BindingsTransactor) ClaimEarningsFor(opts *bind.TransactOpts, _buyer common.Address, _provider common.Address, _bytesUsed *big.Int, _nonce *big.Int, _signature []byte) (*types.Transaction, error) {
	return _Bindings.contract.Transact(opts, "claimEarningsFor", _buyer, _provider, _bytesUsed, _nonce, _signature)
}

// ClaimEarningsFor is a paid mutator transaction binding the contract method 0x862a02fd.
//
// Solidity: function claimEarningsFor(address _buyer, address _provider, uint256 _bytesUsed, uint256 _nonce, bytes _signature) returns()
func (_Bindings *BindingsSession) ClaimEarningsFor(_buyer common.Address, _provider common.Address, _bytesUsed *big.Int, _nonce *big.Int, _signature []byte) (*types.Transaction, error) {
	return _Bindings.Contract.ClaimEarningsFor(&_Bindings.TransactOpts, _buyer, _provider, _bytesUsed, _nonce, _signature)
}

// ClaimEarningsFor is a paid mutator transaction binding the contract method 0x862a02fd.
//
// Solidity: function claimEarningsFor(address _buyer, address _provider, uint256 _bytesUsed, uint256 _nonce, bytes _signature) returns()
func (_Bindings *BindingsTransactorSession) ClaimEarningsFor(_buyer common.Address, _provider common.Address, _bytesUsed *big.Int, _nonce *big.Int, _signature []byte) (*types.Transaction, error) {
	return _Bindings.Contract.ClaimEarningsFor(&_Bindings.TransactOpts, _buyer, _provider, _bytesUsed, _nonce, _signature)
}

// Deposit is a paid mutator transaction binding the contract method 0xd0e30db0.
//
// Solidity: function deposit() payable returns()
func (_Bindings *BindingsTransactor) Deposit(opts *bind.TransactOpts) (*types.Transaction, error) {
	return _Bindings.contract.Transact(opts, "deposit")
}

// Deposit is a paid mutator transaction binding the contract method 0xd0e30db0.
//
// Solidity: function deposit() payable returns()
func (_Bindings *BindingsSession) Deposit() (*types.Transaction, error) {
	return _Bindings.Contract.Deposit(&_Bindings.TransactOpts)
}

// Deposit is a paid mutator transaction binding the contract method 0xd0e30db0.
//
// Solidity: function deposit() payable returns()
func (_Bindings *BindingsTransactorSession) Deposit() (*types.Transaction, error) {
	return _Bindings.Contract.Deposit(&_Bindings.TransactOpts)
}

// RenounceOwnership is a paid mutator transaction binding the contract method 0x715018a6.
//
// Solidity: function renounceOwnership() returns()
func (_Bindings *BindingsTransactor) RenounceOwnership(opts *bind.TransactOpts) (*types.Transaction, error) {
	return _Bindings.contract.Transact(opts, "renounceOwnership")
}

// RenounceOwnership is a paid mutator transaction binding the contract method 0x715018a6.
//
// Solidity: function renounceOwnership() returns()
func (_Bindings *BindingsSession) RenounceOwnership() (*types.Transaction, error) {
	return _Bindings.Contract.RenounceOwnership(&_Bindings.TransactOpts)
}

// RenounceOwnership is a paid mutator transaction binding the contract method 0x715018a6.
//
// Solidity: function renounceOwnership() returns()
func (_Bindings *BindingsTransactorSession) RenounceOwnership() (*types.Transaction, error) {
	return _Bindings.Contract.RenounceOwnership(&_Bindings.TransactOpts)
}

// SetOracle is a paid mutator transaction binding the contract method 0x7adbf973.
//
// Solidity: function setOracle(address _oracle) returns()
func (_Bindings *BindingsTransactor) SetOracle(opts *bind.TransactOpts, _oracle common.Address) (*types.Transaction, error) {
	return _Bindings.contract.Transact(opts, "setOracle", _oracle)
}

// SetOracle is a paid mutator transaction binding the contract method 0x7adbf973.
//
// Solidity: function setOracle(address _oracle) returns()
func (_Bindings *BindingsSession) SetOracle(_oracle common.Address) (*types.Transaction, error) {
	return _Bindings.Contract.SetOracle(&_Bindings.TransactOpts, _oracle)
}

// SetOracle is a paid mutator transaction binding the contract method 0x7adbf973.
//
// Solidity: function setOracle(address _oracle) returns()
func (_Bindings *BindingsTransactorSession) SetOracle(_oracle common.Address) (*types.Transaction, error) {
	return _Bindings.Contract.SetOracle(&_Bindings.TransactOpts, _oracle)
}

// SetPricePerGB is a paid mutator transaction binding the contract method 0xe35ce0bb.
//
// Solidity: function setPricePerGB(uint256 _price) returns()
func (_Bindings *BindingsTransactor) SetPricePerGB(opts *bind.TransactOpts, _price *big.Int) (*types.Transaction, error) {
	return _Bindings.contract.Transact(opts, "setPricePerGB", _price)
}

// SetPricePerGB is a paid mutator transaction binding the contract method 0xe35ce0bb.
//
// Solidity: function setPricePerGB(uint256 _price) returns()
func (_Bindings *BindingsSession) SetPricePerGB(_price *big.Int) (*types.Transaction, error) {
	return _Bindings.Contract.SetPricePerGB(&_Bindings.TransactOpts, _price)
}

// SetPricePerGB is a paid mutator transaction binding the contract method 0xe35ce0bb.
//
// Solidity: function setPricePerGB(uint256 _price) returns()
func (_Bindings *BindingsTransactorSession) SetPricePerGB(_price *big.Int) (*types.Transaction, error) {
	return _Bindings.Contract.SetPricePerGB(&_Bindings.TransactOpts, _price)
}

// TransferOwnership is a paid mutator transaction binding the contract method 0xf2fde38b.
//
// Solidity: function transferOwnership(address newOwner) returns()
func (_Bindings *BindingsTransactor) TransferOwnership(opts *bind.TransactOpts, newOwner common.Address) (*types.Transaction, error) {
	return _Bindings.contract.Transact(opts, "transferOwnership", newOwner)
}

// TransferOwnership is a paid mutator transaction binding the contract method 0xf2fde38b.
//
// Solidity: function transferOwnership(address newOwner) returns()
func (_Bindings *BindingsSession) TransferOwnership(newOwner common.Address) (*types.Transaction, error) {
	return _Bindings.Contract.TransferOwnership(&_Bindings.TransactOpts, newOwner)
}

// TransferOwnership is a paid mutator transaction binding the contract method 0xf2fde38b.
//
// Solidity: function transferOwnership(address newOwner) returns()
func (_Bindings *BindingsTransactorSession) TransferOwnership(newOwner common.Address) (*types.Transaction, error) {
	return _Bindings.Contract.TransferOwnership(&_Bindings.TransactOpts, newOwner)
}

// WithdrawDeposit is a paid mutator transaction binding the contract method 0x33289a46.
//
// Solidity: function withdrawDeposit(uint256 _amount) returns()
func (_Bindings *BindingsTransactor) WithdrawDeposit(opts *bind.TransactOpts, _amount *big.Int) (*types.Transaction, error) {
	return _Bindings.contract.Transact(opts, "withdrawDeposit", _amount)
}

// WithdrawDeposit is a paid mutator transaction binding the contract method 0x33289a46.
//
// Solidity: function withdrawDeposit(uint256 _amount) returns()
func (_Bindings *BindingsSession) WithdrawDeposit(_amount *big.Int) (*types.Transaction, error) {
	return _Bindings.Contract.WithdrawDeposit(&_Bindings.TransactOpts, _amount)
}

// WithdrawDeposit is a paid mutator transaction binding the contract method 0x33289a46.
//
// Solidity: function withdrawDeposit(uint256 _amount) returns()
func (_Bindings *BindingsTransactorSession) WithdrawDeposit(_amount *big.Int) (*types.Transaction, error) {
	return _Bindings.Contract.WithdrawDeposit(&_Bindings.TransactOpts, _amount)
}

// WithdrawEarnings is a paid mutator transaction binding the contract method 0xb73c6ce9.
//
// Solidity: function withdrawEarnings() returns()
func (_Bindings *BindingsTransactor) WithdrawEarnings(opts *bind.TransactOpts) (*types.Transaction, error) {
	return _Bindings.contract.Transact(opts, "withdrawEarnings")
}

// WithdrawEarnings is a paid mutator transaction binding the contract method 0xb73c6ce9.
//
// Solidity: function withdrawEarnings() returns()
func (_Bindings *BindingsSession) WithdrawEarnings() (*types.Transaction, error) {
	return _Bindings.Contract.WithdrawEarnings(&_Bindings.TransactOpts)
}

// WithdrawEarnings is a paid mutator transaction binding the contract method 0xb73c6ce9.
//
// Solidity: function withdrawEarnings() returns()
func (_Bindings *BindingsTransactorSession) WithdrawEarnings() (*types.Transaction, error) {
	return _Bindings.Contract.WithdrawEarnings(&_Bindings.TransactOpts)
}

// WithdrawEarningsFor is a paid mutator transaction binding the contract method 0x688de95c.
//
// Solidity: function withdrawEarningsFor(address _provider) returns()
func (_Bindings *BindingsTransactor) WithdrawEarningsFor(opts *bind.TransactOpts, _provider common.Address) (*types.Transaction, error) {
	return _Bindings.contract.Transact(opts, "withdrawEarningsFor", _provider)
}

// WithdrawEarningsFor is a paid mutator transaction binding the contract method 0x688de95c.
//
// Solidity: function withdrawEarningsFor(address _provider) returns()
func (_Bindings *BindingsSession) WithdrawEarningsFor(_provider common.Address) (*types.Transaction, error) {
	return _Bindings.Contract.WithdrawEarningsFor(&_Bindings.TransactOpts, _provider)
}

// WithdrawEarningsFor is a paid mutator transaction binding the contract method 0x688de95c.
//
// Solidity: function withdrawEarningsFor(address _provider) returns()
func (_Bindings *BindingsTransactorSession) WithdrawEarningsFor(_provider common.Address) (*types.Transaction, error) {
	return _Bindings.Contract.WithdrawEarningsFor(&_Bindings.TransactOpts, _provider)
}

// BindingsDepositIterator is returned from FilterDeposit and is used to iterate over the raw logs and unpacked data for Deposit events raised by the Bindings contract.
type BindingsDepositIterator struct {
	Event *BindingsDeposit // Event containing the contract specifics and raw log

	contract *bind.BoundContract // Generic contract to use for unpacking event data
	event    string              // Event name to use for unpacking event data

	logs chan types.Log        // Log channel receiving the found contract events
	sub  ethereum.Subscription // Subscription for errors, completion and termination
	done bool                  // Whether the subscription completed delivering logs
	fail error                 // Occurred error to stop iteration
}

// Next advances the iterator to the subsequent event, returning whether there
// are any more events found. In case of a retrieval or parsing error, false is
// returned and Error() can be queried for the exact failure.
func (it *BindingsDepositIterator) Next() bool {
	// If the iterator failed, stop iterating
	if it.fail != nil {
		return false
	}
	// If the iterator completed, deliver directly whatever's available
	if it.done {
		select {
		case log := <-it.logs:
			it.Event = new(BindingsDeposit)
			if err := it.contract.UnpackLog(it.Event, it.event, log); err != nil {
				it.fail = err
				return false
			}
			it.Event.Raw = log
			return true

		default:
			return false
		}
	}
	// Iterator still in progress, wait for either a data or an error event
	select {
	case log := <-it.logs:
		it.Event = new(BindingsDeposit)
		if err := it.contract.UnpackLog(it.Event, it.event, log); err != nil {
			it.fail = err
			return false
		}
		it.Event.Raw = log
		return true

	case err := <-it.sub.Err():
		it.done = true
		it.fail = err
		return it.Next()
	}
}

// Error returns any retrieval or parsing error occurred during filtering.
func (it *BindingsDepositIterator) Error() error {
	return it.fail
}

// Close terminates the iteration process, releasing any pending underlying
// resources.
func (it *BindingsDepositIterator) Close() error {
	it.sub.Unsubscribe()
	return nil
}

// BindingsDeposit represents a Deposit event raised by the Bindings contract.
type BindingsDeposit struct {
	Buyer  common.Address
	Amount *big.Int
	Raw    types.Log // Blockchain specific contextual infos
}

// FilterDeposit is a free log retrieval operation binding the contract event 0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c.
//
// Solidity: event Deposit(address indexed buyer, uint256 amount)
func (_Bindings *BindingsFilterer) FilterDeposit(opts *bind.FilterOpts, buyer []common.Address) (*BindingsDepositIterator, error) {

	var buyerRule []interface{}
	for _, buyerItem := range buyer {
		buyerRule = append(buyerRule, buyerItem)
	}

	logs, sub, err := _Bindings.contract.FilterLogs(opts, "Deposit", buyerRule)
	if err != nil {
		return nil, err
	}
	return &BindingsDepositIterator{contract: _Bindings.contract, event: "Deposit", logs: logs, sub: sub}, nil
}

// WatchDeposit is a free log subscription operation binding the contract event 0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c.
//
// Solidity: event Deposit(address indexed buyer, uint256 amount)
func (_Bindings *BindingsFilterer) WatchDeposit(opts *bind.WatchOpts, sink chan<- *BindingsDeposit, buyer []common.Address) (event.Subscription, error) {

	var buyerRule []interface{}
	for _, buyerItem := range buyer {
		buyerRule = append(buyerRule, buyerItem)
	}

	logs, sub, err := _Bindings.contract.WatchLogs(opts, "Deposit", buyerRule)
	if err != nil {
		return nil, err
	}
	return event.NewSubscription(func(quit <-chan struct{}) error {
		defer sub.Unsubscribe()
		for {
			select {
			case log := <-logs:
				// New log arrived, parse the event and forward to the user
				event := new(BindingsDeposit)
				if err := _Bindings.contract.UnpackLog(event, "Deposit", log); err != nil {
					return err
				}
				event.Raw = log

				select {
				case sink <- event:
				case err := <-sub.Err():
					return err
				case <-quit:
					return nil
				}
			case err := <-sub.Err():
				return err
			case <-quit:
				return nil
			}
		}
	}), nil
}

// ParseDeposit is a log parse operation binding the contract event 0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c.
//
// Solidity: event Deposit(address indexed buyer, uint256 amount)
func (_Bindings *BindingsFilterer) ParseDeposit(log types.Log) (*BindingsDeposit, error) {
	event := new(BindingsDeposit)
	if err := _Bindings.contract.UnpackLog(event, "Deposit", log); err != nil {
		return nil, err
	}
	event.Raw = log
	return event, nil
}

// BindingsOwnershipTransferredIterator is returned from FilterOwnershipTransferred and is used to iterate over the raw logs and unpacked data for OwnershipTransferred events raised by the Bindings contract.
type BindingsOwnershipTransferredIterator struct {
	Event *BindingsOwnershipTransferred // Event containing the contract specifics and raw log

	contract *bind.BoundContract // Generic contract to use for unpacking event data
	event    string              // Event name to use for unpacking event data

	logs chan types.Log        // Log channel receiving the found contract events
	sub  ethereum.Subscription // Subscription for errors, completion and termination
	done bool                  // Whether the subscription completed delivering logs
	fail error                 // Occurred error to stop iteration
}

// Next advances the iterator to the subsequent event, returning whether there
// are any more events found. In case of a retrieval or parsing error, false is
// returned and Error() can be queried for the exact failure.
func (it *BindingsOwnershipTransferredIterator) Next() bool {
	// If the iterator failed, stop iterating
	if it.fail != nil {
		return false
	}
	// If the iterator completed, deliver directly whatever's available
	if it.done {
		select {
		case log := <-it.logs:
			it.Event = new(BindingsOwnershipTransferred)
			if err := it.contract.UnpackLog(it.Event, it.event, log); err != nil {
				it.fail = err
				return false
			}
			it.Event.Raw = log
			return true

		default:
			return false
		}
	}
	// Iterator still in progress, wait for either a data or an error event
	select {
	case log := <-it.logs:
		it.Event = new(BindingsOwnershipTransferred)
		if err := it.contract.UnpackLog(it.Event, it.event, log); err != nil {
			it.fail = err
			return false
		}
		it.Event.Raw = log
		return true

	case err := <-it.sub.Err():
		it.done = true
		it.fail = err
		return it.Next()
	}
}

// Error returns any retrieval or parsing error occurred during filtering.
func (it *BindingsOwnershipTransferredIterator) Error() error {
	return it.fail
}

// Close terminates the iteration process, releasing any pending underlying
// resources.
func (it *BindingsOwnershipTransferredIterator) Close() error {
	it.sub.Unsubscribe()
	return nil
}

// BindingsOwnershipTransferred represents a OwnershipTransferred event raised by the Bindings contract.
type BindingsOwnershipTransferred struct {
	PreviousOwner common.Address
	NewOwner      common.Address
	Raw           types.Log // Blockchain specific contextual infos
}

// FilterOwnershipTransferred is a free log retrieval operation binding the contract event 0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0.
//
// Solidity: event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)
func (_Bindings *BindingsFilterer) FilterOwnershipTransferred(opts *bind.FilterOpts, previousOwner []common.Address, newOwner []common.Address) (*BindingsOwnershipTransferredIterator, error) {

	var previousOwnerRule []interface{}
	for _, previousOwnerItem := range previousOwner {
		previousOwnerRule = append(previousOwnerRule, previousOwnerItem)
	}
	var newOwnerRule []interface{}
	for _, newOwnerItem := range newOwner {
		newOwnerRule = append(newOwnerRule, newOwnerItem)
	}

	logs, sub, err := _Bindings.contract.FilterLogs(opts, "OwnershipTransferred", previousOwnerRule, newOwnerRule)
	if err != nil {
		return nil, err
	}
	return &BindingsOwnershipTransferredIterator{contract: _Bindings.contract, event: "OwnershipTransferred", logs: logs, sub: sub}, nil
}

// WatchOwnershipTransferred is a free log subscription operation binding the contract event 0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0.
//
// Solidity: event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)
func (_Bindings *BindingsFilterer) WatchOwnershipTransferred(opts *bind.WatchOpts, sink chan<- *BindingsOwnershipTransferred, previousOwner []common.Address, newOwner []common.Address) (event.Subscription, error) {

	var previousOwnerRule []interface{}
	for _, previousOwnerItem := range previousOwner {
		previousOwnerRule = append(previousOwnerRule, previousOwnerItem)
	}
	var newOwnerRule []interface{}
	for _, newOwnerItem := range newOwner {
		newOwnerRule = append(newOwnerRule, newOwnerItem)
	}

	logs, sub, err := _Bindings.contract.WatchLogs(opts, "OwnershipTransferred", previousOwnerRule, newOwnerRule)
	if err != nil {
		return nil, err
	}
	return event.NewSubscription(func(quit <-chan struct{}) error {
		defer sub.Unsubscribe()
		for {
			select {
			case log := <-logs:
				// New log arrived, parse the event and forward to the user
				event := new(BindingsOwnershipTransferred)
				if err := _Bindings.contract.UnpackLog(event, "OwnershipTransferred", log); err != nil {
					return err
				}
				event.Raw = log

				select {
				case sink <- event:
				case err := <-sub.Err():
					return err
				case <-quit:
					return nil
				}
			case err := <-sub.Err():
				return err
			case <-quit:
				return nil
			}
		}
	}), nil
}

// ParseOwnershipTransferred is a log parse operation binding the contract event 0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0.
//
// Solidity: event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)
func (_Bindings *BindingsFilterer) ParseOwnershipTransferred(log types.Log) (*BindingsOwnershipTransferred, error) {
	event := new(BindingsOwnershipTransferred)
	if err := _Bindings.contract.UnpackLog(event, "OwnershipTransferred", log); err != nil {
		return nil, err
	}
	event.Raw = log
	return event, nil
}

// BindingsUsageSettledIterator is returned from FilterUsageSettled and is used to iterate over the raw logs and unpacked data for UsageSettled events raised by the Bindings contract.
type BindingsUsageSettledIterator struct {
	Event *BindingsUsageSettled // Event containing the contract specifics and raw log

	contract *bind.BoundContract // Generic contract to use for unpacking event data
	event    string              // Event name to use for unpacking event data

	logs chan types.Log        // Log channel receiving the found contract events
	sub  ethereum.Subscription // Subscription for errors, completion and termination
	done bool                  // Whether the subscription completed delivering logs
	fail error                 // Occurred error to stop iteration
}

// Next advances the iterator to the subsequent event, returning whether there
// are any more events found. In case of a retrieval or parsing error, false is
// returned and Error() can be queried for the exact failure.
func (it *BindingsUsageSettledIterator) Next() bool {
	// If the iterator failed, stop iterating
	if it.fail != nil {
		return false
	}
	// If the iterator completed, deliver directly whatever's available
	if it.done {
		select {
		case log := <-it.logs:
			it.Event = new(BindingsUsageSettled)
			if err := it.contract.UnpackLog(it.Event, it.event, log); err != nil {
				it.fail = err
				return false
			}
			it.Event.Raw = log
			return true

		default:
			return false
		}
	}
	// Iterator still in progress, wait for either a data or an error event
	select {
	case log := <-it.logs:
		it.Event = new(BindingsUsageSettled)
		if err := it.contract.UnpackLog(it.Event, it.event, log); err != nil {
			it.fail = err
			return false
		}
		it.Event.Raw = log
		return true

	case err := <-it.sub.Err():
		it.done = true
		it.fail = err
		return it.Next()
	}
}

// Error returns any retrieval or parsing error occurred during filtering.
func (it *BindingsUsageSettledIterator) Error() error {
	return it.fail
}

// Close terminates the iteration process, releasing any pending underlying
// resources.
func (it *BindingsUsageSettledIterator) Close() error {
	it.sub.Unsubscribe()
	return nil
}

// BindingsUsageSettled represents a UsageSettled event raised by the Bindings contract.
type BindingsUsageSettled struct {
	Provider  common.Address
	Buyer     common.Address
	Amount    *big.Int
	BytesUsed *big.Int
	Raw       types.Log // Blockchain specific contextual infos
}

// FilterUsageSettled is a free log retrieval operation binding the contract event 0xfcb4730bd3172588f6ea7adee8efd54549dde79e24495a3006723e882bd46f93.
//
// Solidity: event UsageSettled(address indexed provider, address indexed buyer, uint256 amount, uint256 bytesUsed)
func (_Bindings *BindingsFilterer) FilterUsageSettled(opts *bind.FilterOpts, provider []common.Address, buyer []common.Address) (*BindingsUsageSettledIterator, error) {

	var providerRule []interface{}
	for _, providerItem := range provider {
		providerRule = append(providerRule, providerItem)
	}
	var buyerRule []interface{}
	for _, buyerItem := range buyer {
		buyerRule = append(buyerRule, buyerItem)
	}

	logs, sub, err := _Bindings.contract.FilterLogs(opts, "UsageSettled", providerRule, buyerRule)
	if err != nil {
		return nil, err
	}
	return &BindingsUsageSettledIterator{contract: _Bindings.contract, event: "UsageSettled", logs: logs, sub: sub}, nil
}

// WatchUsageSettled is a free log subscription operation binding the contract event 0xfcb4730bd3172588f6ea7adee8efd54549dde79e24495a3006723e882bd46f93.
//
// Solidity: event UsageSettled(address indexed provider, address indexed buyer, uint256 amount, uint256 bytesUsed)
func (_Bindings *BindingsFilterer) WatchUsageSettled(opts *bind.WatchOpts, sink chan<- *BindingsUsageSettled, provider []common.Address, buyer []common.Address) (event.Subscription, error) {

	var providerRule []interface{}
	for _, providerItem := range provider {
		providerRule = append(providerRule, providerItem)
	}
	var buyerRule []interface{}
	for _, buyerItem := range buyer {
		buyerRule = append(buyerRule, buyerItem)
	}

	logs, sub, err := _Bindings.contract.WatchLogs(opts, "UsageSettled", providerRule, buyerRule)
	if err != nil {
		return nil, err
	}
	return event.NewSubscription(func(quit <-chan struct{}) error {
		defer sub.Unsubscribe()
		for {
			select {
			case log := <-logs:
				// New log arrived, parse the event and forward to the user
				event := new(BindingsUsageSettled)
				if err := _Bindings.contract.UnpackLog(event, "UsageSettled", log); err != nil {
					return err
				}
				event.Raw = log

				select {
				case sink <- event:
				case err := <-sub.Err():
					return err
				case <-quit:
					return nil
				}
			case err := <-sub.Err():
				return err
			case <-quit:
				return nil
			}
		}
	}), nil
}

// ParseUsageSettled is a log parse operation binding the contract event 0xfcb4730bd3172588f6ea7adee8efd54549dde79e24495a3006723e882bd46f93.
//
// Solidity: event UsageSettled(address indexed provider, address indexed buyer, uint256 amount, uint256 bytesUsed)
func (_Bindings *BindingsFilterer) ParseUsageSettled(log types.Log) (*BindingsUsageSettled, error) {
	event := new(BindingsUsageSettled)
	if err := _Bindings.contract.UnpackLog(event, "UsageSettled", log); err != nil {
		return nil, err
	}
	event.Raw = log
	return event, nil
}

// BindingsWithdrawalIterator is returned from FilterWithdrawal and is used to iterate over the raw logs and unpacked data for Withdrawal events raised by the Bindings contract.
type BindingsWithdrawalIterator struct {
	Event *BindingsWithdrawal // Event containing the contract specifics and raw log

	contract *bind.BoundContract // Generic contract to use for unpacking event data
	event    string              // Event name to use for unpacking event data

	logs chan types.Log        // Log channel receiving the found contract events
	sub  ethereum.Subscription // Subscription for errors, completion and termination
	done bool                  // Whether the subscription completed delivering logs
	fail error                 // Occurred error to stop iteration
}

// Next advances the iterator to the subsequent event, returning whether there
// are any more events found. In case of a retrieval or parsing error, false is
// returned and Error() can be queried for the exact failure.
func (it *BindingsWithdrawalIterator) Next() bool {
	// If the iterator failed, stop iterating
	if it.fail != nil {
		return false
	}
	// If the iterator completed, deliver directly whatever's available
	if it.done {
		select {
		case log := <-it.logs:
			it.Event = new(BindingsWithdrawal)
			if err := it.contract.UnpackLog(it.Event, it.event, log); err != nil {
				it.fail = err
				return false
			}
			it.Event.Raw = log
			return true

		default:
			return false
		}
	}
	// Iterator still in progress, wait for either a data or an error event
	select {
	case log := <-it.logs:
		it.Event = new(BindingsWithdrawal)
		if err := it.contract.UnpackLog(it.Event, it.event, log); err != nil {
			it.fail = err
			return false
		}
		it.Event.Raw = log
		return true

	case err := <-it.sub.Err():
		it.done = true
		it.fail = err
		return it.Next()
	}
}

// Error returns any retrieval or parsing error occurred during filtering.
func (it *BindingsWithdrawalIterator) Error() error {
	return it.fail
}

// Close terminates the iteration process, releasing any pending underlying
// resources.
func (it *BindingsWithdrawalIterator) Close() error {
	it.sub.Unsubscribe()
	return nil
}

// BindingsWithdrawal represents a Withdrawal event raised by the Bindings contract.
type BindingsWithdrawal struct {
	User   common.Address
	Amount *big.Int
	Raw    types.Log // Blockchain specific contextual infos
}

// FilterWithdrawal is a free log retrieval operation binding the contract event 0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65.
//
// Solidity: event Withdrawal(address indexed user, uint256 amount)
func (_Bindings *BindingsFilterer) FilterWithdrawal(opts *bind.FilterOpts, user []common.Address) (*BindingsWithdrawalIterator, error) {

	var userRule []interface{}
	for _, userItem := range user {
		userRule = append(userRule, userItem)
	}

	logs, sub, err := _Bindings.contract.FilterLogs(opts, "Withdrawal", userRule)
	if err != nil {
		return nil, err
	}
	return &BindingsWithdrawalIterator{contract: _Bindings.contract, event: "Withdrawal", logs: logs, sub: sub}, nil
}

// WatchWithdrawal is a free log subscription operation binding the contract event 0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65.
//
// Solidity: event Withdrawal(address indexed user, uint256 amount)
func (_Bindings *BindingsFilterer) WatchWithdrawal(opts *bind.WatchOpts, sink chan<- *BindingsWithdrawal, user []common.Address) (event.Subscription, error) {

	var userRule []interface{}
	for _, userItem := range user {
		userRule = append(userRule, userItem)
	}

	logs, sub, err := _Bindings.contract.WatchLogs(opts, "Withdrawal", userRule)
	if err != nil {
		return nil, err
	}
	return event.NewSubscription(func(quit <-chan struct{}) error {
		defer sub.Unsubscribe()
		for {
			select {
			case log := <-logs:
				// New log arrived, parse the event and forward to the user
				event := new(BindingsWithdrawal)
				if err := _Bindings.contract.UnpackLog(event, "Withdrawal", log); err != nil {
					return err
				}
				event.Raw = log

				select {
				case sink <- event:
				case err := <-sub.Err():
					return err
				case <-quit:
					return nil
				}
			case err := <-sub.Err():
				return err
			case <-quit:
				return nil
			}
		}
	}), nil
}

// ParseWithdrawal is a log parse operation binding the contract event 0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65.
//
// Solidity: event Withdrawal(address indexed user, uint256 amount)
func (_Bindings *BindingsFilterer) ParseWithdrawal(log types.Log) (*BindingsWithdrawal, error) {
	event := new(BindingsWithdrawal)
	if err := _Bindings.contract.UnpackLog(event, "Withdrawal", log); err != nil {
		return nil, err
	}
	event.Raw = log
	return event, nil
}
