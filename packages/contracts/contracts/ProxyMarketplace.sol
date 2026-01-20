// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract ProxyMarketplace is Ownable, ReentrancyGuard {
    
    struct Session {
        address buyer;
        address provider;
        uint256 lockedAmount;
        uint256 pricePerGB; // Agreed price at start of session (in wei)
        uint256 startTime;
        bool isActive;
    }

    // Maps sessionID (hash) -> Session
    mapping(bytes32 => Session) public sessions;
    
    // Provider Staking (Simple Registry)
    mapping(address => uint256) public providerStakes;
    uint256 public minStake = 10 ether; // TAO (10e9 decimals usually, but assuming 18 for now)

    event SessionOpened(bytes32 indexed sessionID, address indexed buyer, address indexed provider, uint256 pricePerGB, uint256 lockedAmount);
    event SessionSettled(bytes32 indexed sessionID, uint256 bytesUsed, uint256 cost, uint256 refund);
    event ProviderStaked(address indexed provider, uint256 amount);

    constructor(address _oracleAddress) Ownable(msg.sender) {
        oracleAddress = _oracleAddress;
    }


    address public oracleAddress;
    ProviderRegistry public registry;

    // --- Staking ---
    function stake() external payable {
        providerStakes[msg.sender] += msg.value;
        emit ProviderStaked(msg.sender, providerStakes[msg.sender]);
    }

    function unstake(uint256 _amount) external nonReentrant {
        require(providerStakes[msg.sender] >= _amount, "Insufficient stake");
        providerStakes[msg.sender] -= _amount;
        payable(msg.sender).transfer(_amount);
    }
    
    // Admin: Set Registry
    function setRegistry(address _registry) external onlyOwner {
        registry = ProviderRegistry(_registry);
    }

    // --- Session Logic ---

    // Buyer opens a session with a specific provider at a specific price
    function openSession(address _provider, uint256 _pricePerGB) external payable returns (bytes32) {
        require(msg.value > 0, "Deposit required");
        require(providerStakes[_provider] >= minStake, "Provider not staked");
        
        // Circuit Breaker via Registry
        if (address(registry) != address(0)) {
            require(registry.isAllowedToWork(_provider), "Provider reputation too low or inactive");
        }

        bytes32 sessionID = keccak256(abi.encodePacked(msg.sender, _provider, block.timestamp));
        
        sessions[sessionID] = Session({
            buyer: msg.sender,
            provider: _provider,
            lockedAmount: msg.value,
            pricePerGB: _pricePerGB,
            startTime: block.timestamp,
            isActive: true
        });

        emit SessionOpened(sessionID, msg.sender, _provider, _pricePerGB, msg.value);
        return sessionID;
    }

    // Settle session with Oracle signature
    function settleSession(
        bytes32 _sessionID, 
        uint256 _bytesUsed, 
        uint256 _nonce,
        bytes memory _signature
    ) external nonReentrant {
        Session storage txn = sessions[_sessionID];
        require(txn.isActive, "Session inactive");
        
        bytes32 messageHash = keccak256(abi.encodePacked(_sessionID, _bytesUsed, _nonce));
        address signer = recoverSigner(getEthSignedMessageHash(messageHash), _signature);
        require(signer == oracleAddress, "Invalid signature");

        uint256 cost = (_bytesUsed * txn.pricePerGB) / (1024 * 1024 * 1024);
        
        if (cost > txn.lockedAmount) {
            cost = txn.lockedAmount;
        }

        uint256 refund = txn.lockedAmount - cost;

        txn.isActive = false;
        
        if (cost > 0) {
            payable(txn.provider).transfer(cost);
        }
        
        if (refund > 0) {
            payable(txn.buyer).transfer(refund);
        }
        
        // Auto-Update Reputation (Success)
        if (address(registry) != address(0)) {
            try registry.processSessionOutcome(txn.provider, true) {} catch {}
        }

        emit SessionSettled(_sessionID, _bytesUsed, cost, refund);
    }

    // --- Slashing (Governance/Oracle) ---
    // Penalize malicious provider
    function slashProvider(address _provider, uint256 _amount, string memory _reason) external onlyOwner {
        require(providerStakes[_provider] >= _amount, "Insufficient stake to slash");
        
        providerStakes[_provider] -= _amount;
        
        // Burn slashed funds (send to 0x0 or Treasury)
        // For now, send to treasury (owner)
        payable(owner()).transfer(_amount);
        
        // Slash Reputation
        if (address(registry) != address(0)) {
            try registry.processSessionOutcome(_provider, false) {} catch {}
        }
        
        // Emit Slash Event
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
