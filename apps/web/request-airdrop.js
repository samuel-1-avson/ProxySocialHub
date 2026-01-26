// Request Solana Devnet Airdrop via RPC API
const { Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');

const TREASURY_ADDRESS = 'AYe5qrfZvqoiX19vhcBvCqySXci939tBY7Bx5DkAi9cQ';

async function requestAirdrop() {
    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    const publicKey = new PublicKey(TREASURY_ADDRESS);

    console.log('Requesting airdrop of 2 SOL to:', TREASURY_ADDRESS);

    try {
        const signature = await connection.requestAirdrop(publicKey, 2 * LAMPORTS_PER_SOL);
        console.log('Airdrop requested, signature:', signature);

        // Wait for confirmation
        console.log('Waiting for confirmation...');
        const confirmation = await connection.confirmTransaction(signature, 'confirmed');

        if (confirmation.value.err) {
            console.error('Airdrop failed:', confirmation.value.err);
            return;
        }

        console.log('✅ Airdrop confirmed!');

        // Check balance
        const balance = await connection.getBalance(publicKey);
        console.log('Treasury balance:', balance / LAMPORTS_PER_SOL, 'SOL');

    } catch (error) {
        console.error('Airdrop error:', error.message);
        console.log('\nIf rate limited, try manually at https://faucet.solana.com');
    }
}

requestAirdrop();
