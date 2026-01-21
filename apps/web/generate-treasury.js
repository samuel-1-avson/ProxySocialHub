// Generate Solana Treasury Keypair
const { Keypair } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

// Generate a new keypair
const keypair = Keypair.generate();

// Get the public key (address to receive deposits)
const publicKey = keypair.publicKey.toBase58();

// Get the secret key (keep this secure!)
const secretKey = Array.from(keypair.secretKey);

console.log('='.repeat(60));
console.log('SOLANA TREASURY WALLET GENERATED');
console.log('='.repeat(60));
console.log('');
console.log('PUBLIC KEY (Treasury Address):');
console.log(publicKey);
console.log('');
console.log('Add to your .env:');
console.log(`SOLANA_TREASURY_ADDRESS=${publicKey}`);
console.log(`NEXT_PUBLIC_SOLANA_TREASURY=${publicKey}`);
console.log('');

// Save the keypair to a JSON file (standard Solana format)
const keypairPath = path.join(__dirname, '..', '..', 'treasury-keypair.json');
fs.writeFileSync(keypairPath, JSON.stringify(secretKey));
console.log(`SECRET KEY saved to: ${keypairPath}`);
console.log('');
console.log('⚠️  SECURITY WARNING:');
console.log('1. NEVER commit treasury-keypair.json to git');
console.log('2. In production, use a secure KMS instead');
console.log('3. Back up this keypair securely');
console.log('='.repeat(60));

// Also output for direct use
console.log('');
console.log('To fund this wallet on devnet, run:');
console.log(`solana airdrop 2 ${publicKey} --url devnet`);
console.log('');
console.log('Or use the faucet at: https://faucet.solana.com');
