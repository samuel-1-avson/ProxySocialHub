// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

contract ProviderRegistry is Ownable {
    struct Provider {
        address wallet;
        string metadataURI;      // IPFS hash for profile details
        string connectionDetails; // Endpoint string (e.g. wss://...)
        uint256 reputationScore; // 0-100
        bool isActive;
        bool isVerified;
        uint256 registeredAt;
    }

    mapping(address => Provider) public providers;
    address[] public providerAddresses;

    event ProviderRegistered(address indexed provider, string metadataURI);
    event ProviderUpdated(address indexed provider, string metadataURI, string connectionDetails, bool isActive);
    event ReputationUpdated(address indexed provider, uint256 newScore);
    event ProviderVerified(address indexed provider);

    constructor() Ownable(msg.sender) {}

    // Register a new provider
    function registerProvider(string memory _metadataURI, string memory _connectionDetails) external {
        require(providers[msg.sender].wallet == address(0), "Provider already registered");

        providers[msg.sender] = Provider({
            wallet: msg.sender,
            metadataURI: _metadataURI,
            connectionDetails: _connectionDetails,
            reputationScore: 50, // Start with median reputation
            isActive: true,
            isVerified: false,
            registeredAt: block.timestamp
        });

        providerAddresses.push(msg.sender);
        emit ProviderRegistered(msg.sender, _metadataURI);
    }

    // Update provider details
    function updateProvider(string memory _metadataURI, string memory _connectionDetails, bool _isActive) external {
        require(providers[msg.sender].wallet != address(0), "Provider not registered");
        
        Provider storage p = providers[msg.sender];
        p.metadataURI = _metadataURI;
        p.connectionDetails = _connectionDetails;
        p.isActive = _isActive;

        emit ProviderUpdated(msg.sender, _metadataURI, _connectionDetails, _isActive);
    }

    // Get provider count
    function getProviderCount() external view returns (uint256) {
        return providerAddresses.length;
    }

    address public marketAddress;

    modifier onlyMarketOrOwner() {
        require(msg.sender == owner() || msg.sender == marketAddress, "Not authorized");
        _;
    }

    function setMarketAddress(address _market) external onlyOwner {
        marketAddress = _market;
    }

    // --- Reputation Logic ---

    // Automatically called by Marketplace after a session
    function processSessionOutcome(address _provider, bool _success) external onlyMarketOrOwner {
         require(providers[_provider].wallet != address(0), "Provider not registered");
         
         Provider storage p = providers[_provider];
         if (_success) {
             // Slowly build reputation: +1 up to 100
             if (p.reputationScore < 100) {
                 p.reputationScore += 1;
             }
         } else {
             // Slash reputation heavily for failure: -10
             if (p.reputationScore > 10) {
                 p.reputationScore -= 10;
             } else {
                 p.reputationScore = 0;
             }
         }
         
         emit ReputationUpdated(_provider, p.reputationScore);
    }

    // Update reputation score (Manual overwrite)
    function updateReputation(address _provider, uint256 _newScore) external onlyOwner {
        require(providers[_provider].wallet != address(0), "Provider not registered");
        require(_newScore <= 100, "Score max 100");

        providers[_provider].reputationScore = _newScore;
        emit ReputationUpdated(_provider, _newScore);
    }

    // Check if provider is allowed to work (Circuit Breaker)
    function isAllowedToWork(address _provider) external view returns (bool) {
        if (providers[_provider].wallet == address(0)) return false;
        if (!providers[_provider].isActive) return false;
        // Circuit Breaker: Score must be > 10
        return providers[_provider].reputationScore > 10; 
    }

    // verify provider (KYC check done off-chain)
    function verifyProvider(address _provider) external onlyOwner {
        require(providers[_provider].wallet != address(0), "Provider not registered");
        providers[_provider].isVerified = true;
        emit ProviderVerified(_provider);
    }
}
