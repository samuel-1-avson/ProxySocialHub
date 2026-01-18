import { expect } from "chai";
import { ethers } from "hardhat";

describe("ProxyHubb Decentralized", function () {
    let registry: any;
    let marketplace: any;
    let owner: any;
    let provider: any;
    let buyer: any;
    let oracle: any;

    beforeEach(async function () {
        [owner, provider, buyer, oracle] = await ethers.getSigners();

        // Deploy Registry
        const ProviderRegistry = await ethers.getContractFactory("ProviderRegistry");
        registry = await ProviderRegistry.deploy();

        // Deploy Marketplace with Oracle address
        const ProxyMarketplace = await ethers.getContractFactory("ProxyMarketplace");
        marketplace = await ProxyMarketplace.deploy(oracle.address);
    });

    describe("ProviderRegistry", function () {
        it("Should register a provider", async function () {
            await registry.connect(provider).registerProvider("ipfs://QmHash", "wss://node.com");

            const p = await registry.providers(provider.address);
            expect(p.wallet).to.equal(provider.address);
            expect(p.isActive).to.equal(true);
            expect(p.reputationScore).to.equal(50);
        });

        it("Should update provider details", async function () {
            await registry.connect(provider).registerProvider("ipfs://QmHash", "wss://node.com");
            await registry.connect(provider).updateProvider("ipfs://NewHash", "wss://new.com", false);

            const p = await registry.providers(provider.address);
            expect(p.metadataURI).to.equal("ipfs://NewHash");
            expect(p.isActive).to.equal(false);
        });
    });

    describe("ProxyMarketplace", function () {
        it("Should accept deposits", async function () {
            const depositAmount = ethers.parseEther("1.0");
            await marketplace.connect(buyer).deposit({ value: depositAmount });

            expect(await marketplace.buyerDeposits(buyer.address)).to.equal(depositAmount);
        });

        it("Should process valid earnings claim", async function () {
            // 1. Buyer deposits
            const depositAmount = ethers.parseEther("1.0");
            await marketplace.connect(buyer).deposit({ value: depositAmount });

            // 2. Usage data
            const bytesUsed = 1024 * 1024 * 1024; // 1GB (Cost 0.0001 ETH)
            const nonce = 1;

            // 3. Oracle signs the data
            const messageHash = ethers.solidityPackedKeccak256(
                ["address", "address", "uint256", "uint256"],
                [buyer.address, provider.address, bytesUsed, nonce]
            );
            const signature = await oracle.signMessage(ethers.getBytes(messageHash));

            // 4. Provider claims
            await marketplace.connect(provider).claimEarnings(
                buyer.address,
                bytesUsed,
                nonce,
                signature
            );

            // 5. Check balances
            const cost = ethers.parseEther("0.0001");
            expect(await marketplace.buyerDeposits(buyer.address)).to.equal(depositAmount - cost);
            expect(await marketplace.providerBalances(provider.address)).to.equal(cost);
        });

        it("Should reject invalid signatures", async function () {
            const bytesUsed = 1024;
            const nonce = 1;

            // Signed by ANYONE (e.g. buyer trying to fake it, or provider self-signing)
            // Here provider signs it, but contract expects Oracle
            const messageHash = ethers.solidityPackedKeccak256(
                ["address", "address", "uint256", "uint256"],
                [buyer.address, provider.address, bytesUsed, nonce]
            );
            const signature = await provider.signMessage(ethers.getBytes(messageHash));

            await expect(
                marketplace.connect(provider).claimEarnings(buyer.address, bytesUsed, nonce, signature)
            ).to.be.revertedWith("Invalid signature");
        });
    });
});
