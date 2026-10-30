'use client';

import { FC, ReactNode, useMemo, useState, useEffect } from 'react';
import { ConnectionProvider, WalletProvider, useWallet } from '@solana/wallet-adapter-react';
import {
    BaseMessageSignerWalletAdapter,
    WalletName,
    WalletReadyState,
    WalletAdapterNetwork,
} from '@solana/wallet-adapter-base';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import { clusterApiUrl, Keypair, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';

// Import default styles
import '@solana/wallet-adapter-react-ui/styles.css';
import { WalletAuthSync } from '@/components/WalletAuthSync';
import {
    WALLET_SESSION_RESET_EVENT,
    emitWalletConnectionError,
    formatWalletConnectionError,
    rememberConnectedWalletName,
} from '@/lib/solana-wallet-session';

interface Props {
    children: ReactNode;
}

declare global {
    interface Window {
        __PLAYWRIGHT_SOLANA_TEST_WALLET__?: boolean;
        __PLAYWRIGHT_SOLANA_WALLET_SECRET__?: string;
    }
}

// The Playwright test wallet embeds a private key in the client bundle. It must
// never be active in a production build, even if the env vars are accidentally set.
function playwrightTestWalletEnabled(): boolean {
    if (process.env.NODE_ENV === 'production') {
        return false;
    }
    if (process.env.NEXT_PUBLIC_PLAYWRIGHT_SOLANA_TEST_WALLET === '1') {
        return true;
    }
    if (typeof window !== 'undefined' && window.__PLAYWRIGHT_SOLANA_TEST_WALLET__) {
        return true;
    }
    return false;
}

function playwrightTestWalletSecret(): string | undefined {
    if (process.env.NODE_ENV === 'production') {
        return undefined;
    }
    const fromEnv = process.env.NEXT_PUBLIC_PLAYWRIGHT_SOLANA_WALLET_SECRET;
    if (fromEnv?.trim()) return fromEnv.trim();
    if (typeof window !== 'undefined') {
        const injected = window.__PLAYWRIGHT_SOLANA_WALLET_SECRET__;
        if (injected?.trim()) return injected.trim();
    }
    return undefined;
}

class PlaywrightSolanaTestWalletAdapter extends BaseMessageSignerWalletAdapter<'Playwright Devnet Wallet'> {
    name = 'Playwright Devnet Wallet' as WalletName<'Playwright Devnet Wallet'>;
    url = 'https://proxyhubb.local/e2e-wallet';
    icon = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iOCIgZmlsbD0iIzEwYjk4MSIvPjx0ZXh0IHg9IjE2IiB5PSIyMSIgZm9udC1mYW1pbHk9Im1vbm9zcGFjZSIgZm9udC1zaXplPSIxNCIgZm9udC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iIzAwMCI+UEg8L3RleHQ+PC9zdmc+';
    readyState = WalletReadyState.Loadable;
    supportedTransactionVersions = null;
    connecting = false;
    private keypair: Keypair;
    private walletPublicKey: PublicKey | null = null;

    constructor(secret: string) {
        super();
        this.keypair = Keypair.fromSecretKey(parsePlaywrightSecretKey(secret));
        // E2E: expose pubkey and connect immediately so useWallet() exposes signMessage/signTransaction.
        this.walletPublicKey = this.keypair.publicKey;
        this.readyState = WalletReadyState.Installed;
        void this.connect();
    }

    get publicKey() {
        return this.walletPublicKey;
    }

    async connect() {
        if (!this.walletPublicKey) {
            this.walletPublicKey = this.keypair.publicKey;
        }
        this.emit('connect', this.keypair.publicKey);
    }

    async disconnect() {
        this.walletPublicKey = null;
        this.emit('disconnect');
    }

    async signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> {
        if (transaction instanceof VersionedTransaction) {
            transaction.sign([this.keypair]);
            return transaction;
        }
        transaction.partialSign(this.keypair);
        return transaction;
    }

    async signMessage(message: Uint8Array): Promise<Uint8Array> {
        const { signAsync } = await import('@noble/ed25519');
        return signAsync(message, this.keypair.secretKey.slice(0, 32));
    }
}

function parsePlaywrightSecretKey(raw: string): Uint8Array {
    const trimmed = raw.trim();
    if (trimmed.startsWith('[')) {
        return Uint8Array.from(JSON.parse(trimmed) as number[]);
    }

    const binary = atob(trimmed);
    return Uint8Array.from(binary, char => char.charCodeAt(0));
}

const PLAYWRIGHT_WALLET_NAME = 'Playwright Devnet Wallet' as WalletName<'Playwright Devnet Wallet'>;

function PlaywrightWalletConnector() {
    const { wallets, select, connected, connect } = useWallet();

    useEffect(() => {
        if (!playwrightTestWalletEnabled()) return;
        const entry = wallets.find((w) => w.adapter.name === PLAYWRIGHT_WALLET_NAME);
        if (!entry) return;
        select(PLAYWRIGHT_WALLET_NAME);
        if (!connected) {
            void connect().catch((err) => {
                console.error('Playwright test wallet connect failed:', err);
            });
        }
    }, [wallets, select, connected, connect]);

    return null;
}

/** Persist which wallet connected so the next provider mount restores it. */
function WalletSelectionRecorder() {
    const { connected, wallet } = useWallet();

    useEffect(() => {
        if (connected && wallet) {
            rememberConnectedWalletName(wallet.adapter.name);
        }
    }, [connected, wallet]);

    return null;
}

export const SolanaWalletProvider: FC<Props> = ({ children }) => {
    const [walletError, setWalletError] = useState('');
    // Bumped when a hung attempt wedges the shared adapter flags. The keyed
    // provider below (and every adapter it owns) is recreated, so the next
    // attempt starts from clean flags instead of silently no-op'ing.
    const [sessionEpoch, setSessionEpoch] = useState(0);

    useEffect(() => {
        const onReset = () => setSessionEpoch((epoch) => epoch + 1);
        window.addEventListener(WALLET_SESSION_RESET_EVENT, onReset);
        return () => window.removeEventListener(WALLET_SESSION_RESET_EVENT, onReset);
    }, []);

    const rawNetwork = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';
    const network = rawNetwork === 'mainnet' || rawNetwork === 'mainnet-beta'
        ? 'mainnet-beta'
        : rawNetwork === 'testnet'
            ? 'testnet'
            : 'devnet';

    const endpoint = useMemo(() => {
        // Allow custom RPC endpoint via environment variable
        return process.env.NEXT_PUBLIC_SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC || clusterApiUrl(network);
    }, [network]);

    const [runtimeTestWallet, setRuntimeTestWallet] = useState(false);

    useEffect(() => {
        if (playwrightTestWalletEnabled()) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setRuntimeTestWallet(true);
        }
    }, []);

    const enableTestWallet = playwrightTestWalletEnabled() || runtimeTestWallet;
    const testWalletSecret = playwrightTestWalletSecret();
    // Create adapters on the first client render. This provider only mounts
    // client-side (WalletBoundary is dynamic ssr:false), and starting with an
    // empty wallet list made WalletProvider mount, run its auto-connect
    // bookkeeping against no adapter, then swap adapters in a tick later.
    const wallets = useMemo(() => {
        if (enableTestWallet && testWalletSecret) {
            return [new PlaywrightSolanaTestWalletAdapter(testWalletSecret)];
        }
        return [
            new PhantomWalletAdapter(),
            new SolflareWalletAdapter({ network: network as WalletAdapterNetwork }),
        ];
    // sessionEpoch is intentionally a dependency: a reset must recreate
    // every adapter with clean connection flags.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enableTestWallet, testWalletSecret, network, sessionEpoch]);

    useEffect(() => {
        if (!enableTestWallet || wallets.length === 0) return;
        const adapter = wallets[0];
        if (adapter.connected) return;
        void adapter.connect().catch((err) => {
            console.error('Playwright test wallet connect failed:', err);
        });
    }, [enableTestWallet, wallets]);

    return (
        <ConnectionProvider endpoint={endpoint}>
            {walletError && (
                <div className="ui-error" role="alert">
                    <p>{walletError}</p>
                    <button
                        className="ui-button secondary small"
                        onClick={() => setWalletError('')}
                    >
                        Dismiss
                    </button>
                </div>
            )}
            <WalletProvider
                key={sessionEpoch}
                wallets={wallets}
                // Only silently reconnect an installed browser extension. A
                // loadable web wallet (Solflare) must never auto-open its
                // hosted wallet UI on page load; the user picks it instead.
                autoConnect={async (adapter) => adapter.readyState === WalletReadyState.Installed}
                onError={(err) => {
                    console.error('Wallet Error:', err);
                    // Never swallow a connection failure: show it in the
                    // banner below and next to the connect control.
                    emitWalletConnectionError(err);
                    if (!/Disconnected|Disconnection/.test(err.name || '')) {
                        setWalletError(formatWalletConnectionError(err));
                    }
                }}
            >
                <WalletModalProvider>
                    <PlaywrightWalletConnector />
                    <WalletSelectionRecorder />
                    <WalletAuthSync />
                    {children}
                </WalletModalProvider>
            </WalletProvider>
        </ConnectionProvider>
    );
};
