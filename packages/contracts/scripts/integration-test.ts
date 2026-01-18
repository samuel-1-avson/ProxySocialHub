import { ethers } from "hardhat";

async function main() {
    console.log("Starting End-to-End Integration Test...");

    // 1. Setup Roles
    const [owner, oracle, provider, buyer] = await ethers.getSigners();
    console.log(`Roles:
    Owner: ${owner.address}
    Oracle: ${oracle.address}
    Provider: ${provider.address}
    Buyer: ${buyer.address}
  `);

    // 2. Deploy Contracts
    console.log("\n--- Deploying Contracts ---");
    const ProviderRegistry = await ethers.getContractFactory("ProviderRegistry");
    const registry = await ProviderRegistry.deploy();
    await registry.waitForDeployment();
    console.log(`ProviderRegistry deployed to: ${await registry.getAddress()}`);

    const ProxyMarketplace = await ethers.getContractFactory("ProxyMarketplace");
    const marketplace = await ProxyMarketplace.deploy(
        oracle.address // Set the Oracle signer
    );
    await marketplace.waitForDeployment();
    console.log(`ProxyMarketplace deployed to: ${await marketplace.getAddress()}`);

    // 3. Register Provider
    console.log("\n--- Step 1: Provider Registration ---");
    const connectionDetails = "wss://provider.node:443";
    const metadataURI = "ipfs://QmHash";

    console.log(`Provider Address: ${provider.address}`);
    const bal = await ethers.provider.getBalance(provider.address);
    console.log(`Provider ETH Balance: ${ethers.formatEther(bal)}`);

    try {
        // contract sig: registerProvider(metadataURI, connectionDetails)
        const tx = await registry.connect(provider).registerProvider(metadataURI, connectionDetails);
        await tx.wait();
        console.log("Provider registered successfully.");
    } catch (err: any) {
        console.error("Registration failed. Reason:", err.reason || err.message || err);
        if (err.data) console.error("Error Data:", err.data);
        process.exit(1);
    }

    // Verify registration
    // The public mapping 'providers' generates a getter named 'providers'
    const providerInfo = await registry.providers(provider.address);
    console.log(`Provider Status: ${providerInfo.isActive ? "Active" : "Inactive"}`);

    // 4. Buyer Deposit
    console.log("\n--- Step 2: Buyer Deposit ---");
    const depositAmount = ethers.parseEther("1.0"); // 1 ETH

    await marketplace.connect(buyer).deposit({ value: depositAmount });
    console.log(`Buyer deposited ${ethers.formatEther(depositAmount)} ETH`);

    // Verify deposit
    const buyerBalance = await marketplace.buyerDeposits(buyer.address);
    console.log(`Buyer Marketplace Balance: ${ethers.formatEther(buyerBalance)} ETH`);

    // 5. Simulate Usage & Oracle Signing
    console.log("\n--- Step 3: Usage & Oracle Signing ---");
    // Usage: 1 GB = 1073741824 bytes
    // Rate: Mock implementation in contract might differ, but let's assume contract uses 
    // fixed rate or param. In our contract, we might not have set a rate yet? 
    // Let's check contract logic. 
    // Actually, claimEarnings takes `amount` directly in recent designs? 
    // Wait, looking at previous design: claimEarnings(buyer, bytesUsed, nonce, signature)
    // And contract calculates amount = bytesUsed * rate.

    const bytesUsed = 1073741824n; // 1 GB
    const nonce = BigInt(Date.now());

    // Hash matches Solidity: keccak256(abi.encodePacked(buyer, provider, bytesUsed, nonce))
    // We use ethers.solidityPackedKeccak256
    const messageHash = ethers.solidityPackedKeccak256(
        ["address", "address", "uint256", "uint256"],
        [buyer.address, provider.address, bytesUsed, nonce]
    );

    // Sign the hash (Oracle signs)
    // Note: contentHash is what gets signed. Ethers `signMessage` adds the "\x19Ethereum Signed Message..." prefix automatically.
    // We need to pass the raw bytes of the hash? No, signMessage takes string or bytes.
    // If we pass bytes, it treats it as binary data.
    const signature = await oracle.signMessage(ethers.getBytes(messageHash));
    console.log("Oracle Signature generated.");

    // 6. Provider Claims Earnings
    console.log("\n--- Step 4: Provider Claim ---");

    const initialProviderBalance = await ethers.provider.getBalance(provider.address);
    const initialEscrowBalance = await marketplace.buyerDeposits(buyer.address);

    // Provider calls claimEarnings
    const tx = await marketplace.connect(provider).claimEarnings(
        buyer.address,
        bytesUsed,
        nonce,
        signature
    );
    const receipt = await tx.wait();

    console.log("Claim transaction confirmed.");

    // 7. Verify Balances (Internal Accounting)
    console.log("\n--- Step 5: Verification ---");

    const finalEscrowBalance = await marketplace.buyerDeposits(buyer.address);
    const pendingWithdrawal = await marketplace.providerBalances(provider.address);

    console.log(`Buyer Escrow: ${ethers.formatEther(initialEscrowBalance)} -> ${ethers.formatEther(finalEscrowBalance)} ETH`);
    console.log(`Provider Pending Earnings: ${ethers.formatEther(pendingWithdrawal)} ETH`);

    if (initialEscrowBalance > finalEscrowBalance && pendingWithdrawal > 0n) {
        console.log("SUCCESS: Funds moved from Buyer Escrow to Provider Earnings.");
    } else {
        console.error("FAILURE: Balances did not update as expected.");
        process.exit(1);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
