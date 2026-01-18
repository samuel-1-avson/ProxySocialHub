// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract ProxyMarketplace is Ownable, ReentrancyGuard {
    
    // Usage Receipt signed by Gateway Oracle
    struct UsageReceipt {
        address buyer;
        address provider;
        uint256 bytesUsed;
        uint256 nonce;
        uint256 timestamp;
    }

    address public oracleAddress; // The Gateway signer
    uint256 public pricePerGB = 0.0001 ether; // Default price (can be dynamic)

    mapping(address => uint256) public providerBalances; // Earnings
    mapping(address => uint256) public buyerDeposits;    // Prepaid balance
    mapping(bytes32 => bool) public processedNonces;     // Prevent replay

    event Deposit(address indexed buyer, uint256 amount);
    event Withdrawal(address indexed user, uint256 amount);
    event UsageSettled(address indexed provider, address indexed buyer, uint256 amount, uint256 bytesUsed);

    constructor(address _oracleAddress) Ownable(msg.sender) {
        oracleAddress = _oracleAddress;
    }

    // Buyer deposits funds
    function deposit() external payable {
        buyerDeposits[msg.sender] += msg.value;
        emit Deposit(msg.sender, msg.value);
    }

    // Provider claims earnings with valid signature from Gateway
    // Signature: derived from hash(buyer, provider, bytesUsed, nonce)
    // Generic internal claim logic
    function _claim(address _buyer, address _provider, uint256 _bytesUsed, uint256 _nonce, bytes memory _signature) internal {
        bytes32 messageHash = keccak256(abi.encodePacked(_buyer, _provider, _bytesUsed, _nonce));
        bytes32 ethSignedMessageHash = getEthSignedMessageHash(messageHash);

        require(recoverSigner(ethSignedMessageHash, _signature) == oracleAddress, "Invalid signature");
        require(!processedNonces[messageHash], "Receipt already processed");

        processedNonces[messageHash] = true;

        uint256 cost = (_bytesUsed * pricePerGB) / (1024 * 1024 * 1024);
        
        require(buyerDeposits[_buyer] >= cost, "Insufficent buyer funds");

        buyerDeposits[_buyer] -= cost;
        providerBalances[_provider] += cost;

        emit UsageSettled(_provider, _buyer, cost, _bytesUsed);
    }

    // Provider claims for themselves
    function claimEarnings(
        address _buyer,
        uint256 _bytesUsed,
        uint256 _nonce,
        bytes memory _signature
    ) external nonReentrant {
        _claim(_buyer, msg.sender, _bytesUsed, _nonce, _signature);
    }

    // Relayer claims on behalf of provider
    function claimEarningsFor(
        address _buyer,
        address _provider,
        uint256 _bytesUsed,
        uint256 _nonce,
        bytes memory _signature
    ) external nonReentrant {
        _claim(_buyer, _provider, _bytesUsed, _nonce, _signature);
    }

    // Withdraw provider earnings
    // Withdraw provider earnings (Push to provider)
    function withdrawEarnings() external nonReentrant {
        _withdrawFor(msg.sender);
    }

    // Relayer triggers withdrawal for a provider (Gas paid by Relayer, funds go to Provider)
    function withdrawEarningsFor(address _provider) external nonReentrant {
        _withdrawFor(_provider);
    }

    function _withdrawFor(address _provider) internal {
        uint256 amount = providerBalances[_provider];
        require(amount > 0, "No earnings");

        providerBalances[_provider] = 0;
        (bool success, ) = payable(_provider).call{value: amount}("");
        require(success, "Transfer failed");

        emit Withdrawal(_provider, amount);
    }

    // Withdraw unused buyer deposit
    function withdrawDeposit(uint256 _amount) external nonReentrant {
        require(buyerDeposits[msg.sender] >= _amount, "Insufficient balance");
        
        buyerDeposits[msg.sender] -= _amount;
        (bool success, ) = payable(msg.sender).call{value: _amount}("");
        require(success, "Transfer failed");

        emit Withdrawal(msg.sender, _amount);
    }

    // Admin: Update pricing
    function setPricePerGB(uint256 _price) external onlyOwner {
        pricePerGB = _price;
    }

    // Admin: Set Oracle
    function setOracle(address _oracle) external onlyOwner {
        oracleAddress = _oracle;
    }

    // --- ECDSA Helpers ---
    function getEthSignedMessageHash(bytes32 _messageHash) public pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", _messageHash));
    }

    function recoverSigner(bytes32 _ethSignedMessageHash, bytes memory _signature) public pure returns (address) {
        (bytes32 r, bytes32 s, uint8 v) = splitSignature(_signature);
        return ecrecover(_ethSignedMessageHash, v, r, s);
    }

    function splitSignature(bytes memory sig) public pure returns (bytes32 r, bytes32 s, uint8 v) {
        require(sig.length == 65, "Invalid signature length");
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
    }
}
