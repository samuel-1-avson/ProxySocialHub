import { ethers } from "hardhat";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);

    // 1. Deploy ProviderRegistry
    const ProviderRegistry = await ethers.getContractFactory("ProviderRegistry");
    const registry = await ProviderRegistry.deploy();
    await registry.waitForDeployment();
    console.log(`ProviderRegistry deployed to ${registry.target}`);

    // 2. Deploy ProxyMarketplace
    // Assuming the deployer is the Oracle for now
    const ProxyMarketplace = await ethers.getContractFactory("ProxyMarketplace");
    const marketplace = await ProxyMarketplace.deploy(deployer.address);
    await marketplace.waitForDeployment();
    console.log(`ProxyMarketplace deployed to ${marketplace.target}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
