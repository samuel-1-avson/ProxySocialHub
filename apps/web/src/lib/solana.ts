import { Program, AnchorProvider, web3, BN, Idl } from '@project-serum/anchor';
import { Connection, PublicKey } from '@solana/web3.js';
import idl from './idl/proxyhub.json';

// Constants
const PROGRAM_ID = new PublicKey('2yDRyTwhHnVakKKMhhGG61V9b78RUdXRjAL3UiPwmDd7');
const NETWORK = 'https://api.devnet.solana.com';

export const getProgram = (wallet: any) => {
    const connection = new Connection(NETWORK, 'processed');
    const provider = new AnchorProvider(
        connection,
        wallet,
        { preflightCommitment: 'processed' }
    );
    return new Program(idl as Idl, PROGRAM_ID, provider);
};

export const initializeEscrow = async (
    wallet: any,
    sellerPubkey: string,
    amountLamports: number,
    limitGb: number
) => {
    if (!wallet) throw new Error("Wallet not connected");

    const program = getProgram(wallet);
    const buyer = wallet.publicKey;
    const seller = new PublicKey(sellerPubkey);

    // Find PDA
    const [escrowPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("escrow"),
            buyer.toBuffer(),
            seller.toBuffer()
        ],
        program.programId
    );

    console.log("Initializing Escrow PDA:", escrowPda.toString());

    try {
        const tx = await program.methods
            .initializeEscrow(
                new BN(amountLamports),
                new BN(limitGb),
                new BN(3600 * 24) // 24 hours expiry
            )
            .accounts({
                buyer: buyer,
                seller: seller,
                escrow: escrowPda,
                systemProgram: web3.SystemProgram.programId,
            })
            .rpc();

        console.log("Escrow Initialized, Tx:", tx);
        return { tx, escrowPda: escrowPda.toString() };

    } catch (err) {
        console.error("Escrow Init Error:", err);
        throw err;
    }
};
