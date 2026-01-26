'use client';

import { FC } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import styles from './SolanaWalletButton.module.css';

export const SolanaWalletButton: FC = () => {
    const { publicKey, connected, disconnect } = useWallet();

    return (
        <div className={styles.walletContainer}>
            <WalletMultiButton className={styles.walletButton} />
            {connected && publicKey && (
                <div className={styles.walletInfo}>
                    <span className={styles.walletAddress}>
                        {publicKey.toBase58().slice(0, 4)}...{publicKey.toBase58().slice(-4)}
                    </span>
                    <button
                        onClick={() => disconnect()}
                        className="ml-2 px-2 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-500 text-[9px] font-black uppercase rounded border border-red-500/20 transition-all"
                    >
                        Disconnect
                    </button>
                </div>
            )}
        </div>
    );
};

export default SolanaWalletButton;
