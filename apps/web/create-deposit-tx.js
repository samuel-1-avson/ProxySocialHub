// Send SOL from treasury to itself to create a fresh transaction for testing
// This uses the treasury keypair that was generated earlier
const { Keypair, Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, sendAndConfirmTransaction } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

const TREASURY_ADDRESS = '8P4uuapgGfW8L7VvdQJ9W7RpJqpfyifhPx9UQaHnKii2';
const DEVNET_URL = 'https://api.devnet.solana.com';

async function main() {
    // Load treasury keypair
    const keypairPath = path.join(__dirname, '..', '..', 'treasury-keypair.json');

    if (!fs.existsSync(keypairPath)) {
        console.error('❌ Treasury keypair not found at:', keypairPath);
        console.log('Run generate-treasury.js first to create the keypair.');
        return;
    }

    const secretKey = JSON.parse(fs.readFileSync(keypairPath, 'utf8'));
    const treasuryKeypair = Keypair.fromSecretKey(Uint8Array.from(secretKey));

    console.log('='.repeat(60));
    console.log('TREASURY SELF-TRANSFER TEST');
    console.log('='.repeat(60));
    console.log('Treasury Address:', treasuryKeypair.publicKey.toBase58());

    const connection = new Connection(DEVNET_URL, 'confirmed');

    // Check balance
    const balance = await connection.getBalance(treasuryKeypair.publicKey);
    console.log('Current balance:', balance / LAMPORTS_PER_SOL, 'SOL');

    if (balance < 0.1 * LAMPORTS_PER_SOL) {
        console.error('❌ Insufficient balance. Need at least 0.1 SOL.');
        console.log('Fund the treasury at https://faucet.solana.com');
        return;
    }

    // Create a new test wallet to receive funds (simulates a user wallet)
    const testReceiver = Keypair.generate();
    console.log('Test Receiver:', testReceiver.publicKey.toBase58());

    // Send a small amount from treasury (this simulates a deposit that was reverse transferred)
    // Actually, we want to TEST the deposit, so we need to send TO the treasury.
    // Let's send treasury funds to a test wallet, then send back to create a verifiable tx

    // First, send from treasury to test wallet
    const sendAmount = 0.05;
    console.log(`\nStep 1: Sending ${sendAmount} SOL to test wallet...`);

    const tx1 = new Transaction().add(
        SystemProgram.transfer({
            fromPubkey: treasuryKeypair.publicKey,
            toPubkey: testReceiver.publicKey,
            lamports: sendAmount * LAMPORTS_PER_SOL,
        })
    );

    const sig1 = await sendAndConfirmTransaction(connection, tx1, [treasuryKeypair]);
    console.log('✅ Sent to test wallet:', sig1);

    // Now send back from test wallet to treasury (THIS is the deposit transaction!)
    console.log(`\nStep 2: Sending ${sendAmount - 0.001} SOL back to treasury (deposit)...`);

    const depositAmount = sendAmount - 0.001; // minus fee
    const tx2 = new Transaction().add(
        SystemProgram.transfer({
            fromPubkey: testReceiver.publicKey,
            toPubkey: treasuryKeypair.publicKey,
            lamports: Math.floor(depositAmount * LAMPORTS_PER_SOL),
        })
    );

    const depositSignature = await sendAndConfirmTransaction(connection, tx2, [testReceiver]);

    console.log('');
    console.log('='.repeat(60));
    console.log('✅ DEPOSIT TRANSACTION CREATED!');
    console.log('='.repeat(60));
    console.log('');
    console.log('📋 USE THIS TRANSACTION HASH:');
    console.log(depositSignature);
    console.log('');
    console.log('💰 AMOUNT:', depositAmount.toFixed(4), 'SOL');
    console.log('');
    console.log('📍 View on Explorer:');
    console.log(`https://explorer.solana.com/tx/${depositSignature}?cluster=devnet`);
    console.log('');
    console.log('Now paste this hash into the wallet deposit form!');
    console.log('='.repeat(60));
}

main().catch(console.error);
