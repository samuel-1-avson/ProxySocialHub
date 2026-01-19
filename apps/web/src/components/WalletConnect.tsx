'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { Loader2, Wallet } from 'lucide-react';
import { web3Enable, web3Accounts } from '@polkadot/extension-dapp';

interface WalletAccount {
    address: string;
    meta: {
        name?: string;
        source: string;
    };
}

interface WalletConnectProps {
    onLogin: (address: string, signer: any) => Promise<void>;
}

export function WalletConnect({ onLogin }: WalletConnectProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [accounts, setAccounts] = useState<WalletAccount[]>([]);
    const [error, setError] = useState<string | null>(null);

    const connectWallet = async () => {
        setLoading(true);
        setError(null);
        try {
            // 1. Enable extension
            const extensions = await web3Enable('ProxySocialHub');
            if (extensions.length === 0) {
                throw new Error('No Polkadot-compatible wallet extension found. Please install Talisman or Polkadot.js.');
            }

            // 2. Get accounts
            const allAccounts = await web3Accounts();
            setAccounts(allAccounts);

            if (allAccounts.length === 0) {
                throw new Error('No accounts found. Please add an account to your wallet.');
            }
        } catch (err: any) {
            setError(err.message || 'Failed to connect wallet');
        } finally {
            setLoading(false);
        }
    };

    const handleAccountSelect = async (account: WalletAccount) => {
        setLoading(true);
        try {
            const { web3FromSource } = await import('@polkadot/extension-dapp');
            const injector = await web3FromSource(account.meta.source);
            await onLogin(account.address, injector.signer);
            setIsOpen(false);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" className="gap-2">
                    <Wallet className="h-4 w-4" />
                    Connect Wallet
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Connect Wallet</DialogTitle>
                </DialogHeader>

                <div className="flex flex-col gap-4 py-4">
                    {!accounts.length && !loading && !error && (
                        <div className="text-center">
                            <p className="text-muted-foreground mb-4">
                                Connect your Bittensor/Polkadot wallet to sign in.
                            </p>
                            <Button onClick={connectWallet} className="w-full">
                                Connect Extension
                            </Button>
                        </div>
                    )}

                    {loading && (
                        <div className="flex justify-center py-4">
                            <Loader2 className="h-8 w-8 animate-spin" />
                        </div>
                    )}

                    {error && (
                        <div className="text-red-500 text-sm text-center bg-red-50 p-2 rounded">
                            {error}
                            <Button variant="link" onClick={connectWallet} className="px-1 py-0 h-auto font-normal">Try Again</Button>
                        </div>
                    )}

                    {accounts.length > 0 && (
                        <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto">
                            <p className="text-sm text-muted-foreground mb-2">Select an account to sign in:</p>
                            {accounts.map((acc) => (
                                <Button
                                    key={acc.address}
                                    variant="ghost"
                                    className="justify-start h-auto py-3 px-4 border"
                                    onClick={() => handleAccountSelect(acc)}
                                    disabled={loading}
                                >
                                    <div className="flex flex-col items-start gap-1 text-left w-full">
                                        <span className="font-medium">{acc.meta.name || 'Unknown Account'}</span>
                                        <span className="text-xs text-muted-foreground font-mono break-all line-clamp-1">
                                            {acc.address}
                                        </span>
                                        <span className="text-[10px] text-muted-foreground uppercase bg-secondary px-1.5 rounded">
                                            {acc.meta.source}
                                        </span>
                                    </div>
                                </Button>
                            ))}
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
