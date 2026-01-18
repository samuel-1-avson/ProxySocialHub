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

    // --- Admin Functions ---

    // Update reputation score (called by Oracle/Admin)
    function updateReputation(address _provider, uint256 _newScore) external onlyOwner {
        require(providers[_provider].wallet != address(0), "Provider not registered");
        require(_newScore <= 100, "Score max 100");

        providers[_provider].reputationScore = _newScore;
        emit ReputationUpdated(_provider, _newScore);
    }

    // verify provider (KYC check done off-chain)
    function verifyProvider(address _provider) external onlyOwner {
        require(providers[_provider].wallet != address(0), "Provider not registered");
        providers[_provider].isVerified = true;
        emit ProviderVerified(_provider);
    }
}
