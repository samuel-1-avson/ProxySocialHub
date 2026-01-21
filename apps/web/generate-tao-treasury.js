// Generate a Bittensor-compatible wallet (Substrate SS58 format)
// Bittensor uses SS58 prefix 42 (generic Substrate) for addresses

const { Keyring } = require('@polkadot/keyring');
const { mnemonicGenerate, cryptoWaitReady } = require('@polkadot/util-crypto');

async function generateBittensorWallet() {
    await cryptoWaitReady();

    console.log('='.repeat(60));
    console.log('BITTENSOR TREASURY WALLET GENERATOR');
    console.log('='.repeat(60));
    console.log('');

    // Generate a new mnemonic
    const mnemonic = mnemonicGenerate();

    // Create keyring with SS58 format 42 (Substrate generic, used by Bittensor)
    const keyring = new Keyring({ type: 'sr25519', ss58Format: 42 });

    // Add the mnemonic to keyring
    const pair = keyring.addFromMnemonic(mnemonic);

    console.log('📋 MNEMONIC PHRASE (SAVE THIS SECURELY!):');
    console.log('-'.repeat(60));
    console.log(mnemonic);
    console.log('-'.repeat(60));
    console.log('');
    console.log('🔑 PUBLIC KEY (SS58 ADDRESS):');
    console.log(pair.address);
    console.log('');
    console.log('📍 This address is compatible with:');
    console.log('   - Bittensor Mainnet (Finney)');
    console.log('   - Bittensor Testnet');
    console.log('   - Any Substrate chain with SS58 prefix 42');
    console.log('');
    console.log('='.repeat(60));
    console.log('NEXT STEPS:');
    console.log('='.repeat(60));
    console.log('');
    console.log('1. SAVE the mnemonic phrase securely (never share it!)');
    console.log('');
    console.log('2. For TESTNET TAO, use one of these options:');
    console.log('   - Miners Union Faucet: https://minersunion.ai (up to 50 test TAO)');
    console.log('   - Bittensor Discord: Request testnet TAO in #testnet channel');
    console.log('');
    console.log('3. Update your environment variables:');
    console.log('');
    console.log('   docker-compose.dev.yml:');
    console.log(`   - TAO_TREASURY_ADDRESS=${pair.address}`);
    console.log('   - BITTENSOR_NETWORK=testnet');
    console.log('');
    console.log('   Vercel (NEXT_PUBLIC_TAO_TREASURY):');
    console.log(`   ${pair.address}`);
    console.log('');
    console.log('='.repeat(60));

    // Save to file
    const walletData = {
        address: pair.address,
        mnemonic: mnemonic,
        type: 'sr25519',
        ss58Format: 42,
        network: 'bittensor',
        generatedAt: new Date().toISOString()
    };

    require('fs').writeFileSync('tao-treasury-keypair.json', JSON.stringify(walletData, null, 2));
    console.log('');
    console.log('⚠️  Wallet saved to tao-treasury-keypair.json');
    console.log('⚠️  Add this file to .gitignore immediately!');
    console.log('');
}

generateBittensorWallet().catch(console.error);
