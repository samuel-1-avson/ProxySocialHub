'use client';

import { useAuth } from '@/lib/auth';
import { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { API_BASE_URL, fetchWithAuth } from '@/lib/services/client';
import styles from './LinkedWallets.module.css';

interface LinkedWallet {
    id: string;
    chain: 'solana' | 'ethereum' | 'bittensor';
    address: string;
    verified: boolean;
    is_primary: boolean;
    label?: string;
    created_at: string;
}

const CHAIN_ICONS: Record<string, string> = {
    solana: '🟣',
    ethereum: '🔷',
    bittensor: '🧠',
};

const CHAIN_COLORS: Record<string, string> = {
    solana: '#9945FF',
    ethereum: '#627EEA',
    bittensor: '#00D395',
};

export default function LinkedWalletsPage() {
    const { user } = useAuth();
    const [wallets, setWallets] = useState<LinkedWallet[]>([]);
    const [loading, setLoading] = useState(true);
    const [linking, setLinking] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const { publicKey, signMessage, connected } = useWallet();
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    const fetchWallets = async () => {
        try {
            const response = await fetchWithAuth(`${API_BASE_URL}/v1/linked-wallets`);

            if (response.ok) {
                const data = await response.json();
                setWallets(data);
            }
        } catch (err) {
            console.error('Failed to fetch wallets:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchWallets();
    }, []);

    const linkSolanaWallet = async () => {
        if (!publicKey || !signMessage) {
            setError('Please connect your Solana wallet first');
            return;
        }

        setLinking(true);
        setError(null);

        try {
            // Create message to sign
            const message = `Sign this message to link your wallet to ProxySocialHub.\n\nWallet: ${publicKey.toString()}\nTimestamp: ${Date.now()}`;
            const encodedMessage = new TextEncoder().encode(message);

            // Sign the message
            const signature = await signMessage(encodedMessage);
            const signatureBase64 = Buffer.from(signature).toString('base64');

            // Send to backend
            const response = await fetchWithAuth(`${API_BASE_URL}/v1/linked-wallets`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    chain: 'solana',
                    address: publicKey.toString(),
                    signature: signatureBase64,
                    message: message,
                    label: 'Solana Wallet',
                }),
            });

            if (response.ok) {
                setSuccess('Wallet linked successfully!');
                fetchWallets();
            } else {
                const data = await response.json();
                setError(data.error || 'Failed to link wallet');
            }
        } catch (err) {
            const error = err as Error;
            setError(error.message || 'Failed to sign message');
        } finally {
            setLinking(false);
        }
    };

    const linkBittensorWallet = async () => {
        setLinking(true);
        setError(null);

        try {
            // Dynamically import browser-only libraries to avoid SSR errors
            const { web3Accounts, web3Enable, web3FromSource } = await import('@polkadot/extension-dapp');
            const { stringToHex } = await import('@polkadot/util');

            const extensions = await web3Enable('ProxySocialHub');
            if (extensions.length === 0) {
                throw new Error('No Substrate extension found. Please install Subwallet or Bittensor wallet.');
            }

            const allAccounts = await web3Accounts();
            if (allAccounts.length === 0) {
                throw new Error('No accounts found in your wallet extension.');
            }

            // For now, take the first account. In a real app, show a picker.
            const account = allAccounts[0];
            const injector = await web3FromSource(account.meta.source);

            const message = `Sign this message to link your Bittensor wallet to ProxySocialHub.\n\nWallet: ${account.address}\nUser ID: ${user?.id}\nTimestamp: ${Date.now()}`;

            if (!injector.signer.signRaw) {
                throw new Error('Wallet does not support raw message signing');
            }

            const { signature } = await injector.signer.signRaw({
                address: account.address,
                data: stringToHex(message),
                type: 'bytes'
            });

            // Send to backend
            const response = await fetchWithAuth(`${API_BASE_URL}/v1/wallet/link`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    chain: 'bittensor',
                    wallet_address: account.address,
                    signature: signature,
                    message: message,
                }),
            });

            if (response.ok) {
                setSuccess('Bittensor wallet linked successfully!');
                fetchWallets();
            } else {
                const data = await response.json();
                setError(data.error || 'Failed to link Bittensor wallet');
            }
        } catch (err) {
            const error = err as Error;
            setError(error.message || 'Failed to link Bittensor wallet');
        } finally {
            setLinking(false);
        }
    };

    const setPrimaryWallet = async (walletId: string) => {
        try {
            const response = await fetchWithAuth(`${API_BASE_URL}/v1/linked-wallets/${walletId}/primary`, {
                method: 'PUT',
            });

            if (response.ok) {
                setSuccess('Primary wallet updated!');
                fetchWallets();
            }
        } catch (err) {
            console.error('Failed to set primary wallet:', err);
            setError('Failed to set primary wallet');
        }
    };

    const unlinkWallet = async (walletId: string) => {
        if (!confirm('Are you sure you want to unlink this wallet?')) return;

        try {
            const response = await fetchWithAuth(`${API_BASE_URL}/v1/linked-wallets/${walletId}`, {
                method: 'DELETE',
            });

            if (response.ok) {
                setSuccess('Wallet unlinked successfully!');
                fetchWallets();
            }
        } catch (err) {
            console.error('Failed to unlink wallet:', err);
            setError('Failed to unlink wallet');
        }
    };

    const shortenAddress = (address: string) => {
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    };

    const isWalletAlreadyLinked = (chain: string, address: string) => {
        return wallets.some(w => w.chain === chain && w.address === address);
    };

    if (!mounted) {
        return <div className={styles.container}>Loading dashboard...</div>;
    }

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h1>Linked Wallets</h1>
                <p>Connect and manage your blockchain wallets for seamless transactions</p>
            </div>

            {error && (
                <div className={styles.errorAlert}>
                    {error}
                    <button onClick={() => setError(null)}>×</button>
                </div>
            )}

            {success && (
                <div className={styles.successAlert}>
                    {success}
                    <button onClick={() => setSuccess(null)}>×</button>
                </div>
            )}

            <div className={styles.section}>
                <h2>Connect New Wallet</h2>

                <div className={styles.connectOptions}>
                    {/* Solana */}
                    <div className={styles.connectCard}>
                        <div className={styles.chainHeader}>
                            <span className={styles.chainIcon} style={{ background: CHAIN_COLORS.solana }}>
                                {CHAIN_ICONS.solana}
                            </span>
                            <span>Solana</span>
                        </div>

                        {connected && publicKey ? (
                            isWalletAlreadyLinked('solana', publicKey.toString()) ? (
                                <span className={styles.alreadyLinked}>✓ Already linked</span>
                            ) : (
                                <button
                                    className={styles.linkButton}
                                    onClick={linkSolanaWallet}
                                    disabled={linking}
                                >
                                    {linking ? 'Linking...' : 'Link Wallet'}
                                </button>
                            )
                        ) : (
                            <WalletMultiButton className={styles.walletButton} />
                        )}
                    </div>

                    {/* Ethereum */}
                    <div className={styles.connectCard}>
                        <div className={styles.chainHeader}>
                            <span className={styles.chainIcon} style={{ background: CHAIN_COLORS.ethereum }}>
                                {CHAIN_ICONS.ethereum}
                            </span>
                            <span>Ethereum</span>
                        </div>
                        <button className={styles.linkButtonDisabled} disabled>
                            Coming Soon
                        </button>
                    </div>

                    {/* Bittensor */}
                    <div className={styles.connectCard}>
                        <div className={styles.chainHeader}>
                            <span className={styles.chainIcon} style={{ background: CHAIN_COLORS.bittensor }}>
                                {CHAIN_ICONS.bittensor}
                            </span>
                            <span>Bittensor (TAO)</span>
                        </div>
                        {isWalletAlreadyLinked('bittensor', '') ? ( // Check if any bittensor wallet is linked
                            <span className={styles.alreadyLinked}>✓ Linked</span>
                        ) : (
                            <button
                                className={styles.linkButton}
                                onClick={linkBittensorWallet}
                                disabled={linking}
                            >
                                {linking ? 'Linking...' : 'Link Bittensor Wallet'}
                            </button>
                        )}
                    </div>
                </div>
            </div>

            <div className={styles.section}>
                <h2>Your Linked Wallets</h2>

                {loading ? (
                    <div className={styles.loading}>Loading wallets...</div>
                ) : wallets.length === 0 ? (
                    <div className={styles.emptyState}>
                        <p>No wallets linked yet. Connect a wallet above to get started.</p>
                    </div>
                ) : (
                    <div className={styles.walletList}>
                        {wallets.map((wallet) => (
                            <div key={wallet.id} className={styles.walletCard}>
                                <div className={styles.walletInfo}>
                                    <span
                                        className={styles.chainIcon}
                                        style={{ background: CHAIN_COLORS[wallet.chain] }}
                                    >
                                        {CHAIN_ICONS[wallet.chain]}
                                    </span>
                                    <div className={styles.walletDetails}>
                                        <div className={styles.walletAddress}>
                                            {shortenAddress(wallet.address)}
                                            <button
                                                className={styles.copyButton}
                                                onClick={() => navigator.clipboard.writeText(wallet.address)}
                                                title="Copy address"
                                            >
                                                📋
                                            </button>
                                        </div>
                                        <div className={styles.walletMeta}>
                                            <span className={styles.chainBadge}>{wallet.chain}</span>
                                            {wallet.is_primary && (
                                                <span className={styles.primaryBadge}>Primary</span>
                                            )}
                                            {wallet.verified && (
                                                <span className={styles.verifiedBadge}>✓ Verified</span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className={styles.walletActions}>
                                    {!wallet.is_primary && (
                                        <button
                                            className={styles.actionButton}
                                            onClick={() => setPrimaryWallet(wallet.id)}
                                        >
                                            Set Primary
                                        </button>
                                    )}
                                    <button
                                        className={styles.unlinkButton}
                                        onClick={() => unlinkWallet(wallet.id)}
                                    >
                                        Unlink
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
