// Test Wallet - Generate keypair, fund via airdrop, and send SOL to treasury
const { Keypair, Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, sendAndConfirmTransaction } = require('@solana/web3.js');

const TREASURY_ADDRESS = 'AYe5qrfZvqoiX19vhcBvCqySXci939tBY7Bx5DkAi9cQ';
const DEVNET_URL = 'https://api.devnet.solana.com';

async function main() {
    const connection = new Connection(DEVNET_URL, 'confirmed');

    // Generate new test wallet
    const testWallet = Keypair.generate();
    console.log('='.repeat(60));
    console.log('TEST WALLET CREATED');
    console.log('='.repeat(60));
    console.log('Test Wallet Address:', testWallet.publicKey.toBase58());
    console.log('');

    // Request airdrop
    console.log('Requesting airdrop of 2 SOL...');
    try {
        const airdropSig = await connection.requestAirdrop(testWallet.publicKey, 2 * LAMPORTS_PER_SOL);
        console.log('Airdrop requested, waiting for confirmation...');
        await connection.confirmTransaction(airdropSig, 'confirmed');
        console.log('✅ Airdrop confirmed!');
    } catch (err) {
        console.log('❌ Airdrop failed (rate limited). Try again in a few minutes.');
        console.log('');
        console.log('Alternative: Fund this wallet manually via https://faucet.solana.com');
        console.log('Address:', testWallet.publicKey.toBase58());
        console.log('');
        console.log('Then run: node send-to-treasury.js ' + Buffer.from(testWallet.secretKey).toString('base64'));
        return;
    }

    // Check balance
    let balance = await connection.getBalance(testWallet.publicKey);
    console.log('Test wallet balance:', balance / LAMPORTS_PER_SOL, 'SOL');
    console.log('');

    // Send SOL to treasury
    const sendAmount = 0.5; // Send 0.5 SOL for testing
    console.log(`Sending ${sendAmount} SOL to treasury...`);

    const treasuryPubkey = new PublicKey(TREASURY_ADDRESS);
    const transaction = new Transaction().add(
        SystemProgram.transfer({
            fromPubkey: testWallet.publicKey,
            toPubkey: treasuryPubkey,
            lamports: sendAmount * LAMPORTS_PER_SOL,
        })
    );

    try {
        const signature = await sendAndConfirmTransaction(connection, transaction, [testWallet]);
        console.log('');
        console.log('='.repeat(60));
        console.log('✅ TRANSACTION SUCCESSFUL!');
        console.log('='.repeat(60));
        console.log('');
        console.log('📋 USE THIS TRANSACTION HASH:');
        console.log(signature);
        console.log('');
        console.log('💰 AMOUNT SENT:', sendAmount, 'SOL');
        console.log('');
        console.log('📍 View on Solana Explorer:');
        console.log(`https://explorer.solana.com/tx/${signature}?cluster=devnet`);
        console.log('');
        console.log('Now paste this hash into the wallet deposit form!');
        console.log('='.repeat(60));
    } catch (err) {
        console.error('❌ Transfer failed:', err.message);
    }
}

main().catch(console.error);
