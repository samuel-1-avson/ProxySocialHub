'use client';

import React, { useEffect, useState } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription
} from "@/components/ui/dialog";
import { Loader2, Wallet, CheckCircle, ExternalLink } from 'lucide-react';
import { cn } from "@/lib/utils";

interface SubstrateAccount {
    address: string;
    meta: {
        name?: string;
        source: string;
    };
}

interface SubstrateWalletModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (account: SubstrateAccount) => void;
}

export const SubstrateWalletModal: React.FC<SubstrateWalletModalProps> = ({
    isOpen,
    onClose,
    onSelect
}) => {
    const [accounts, setAccounts] = useState<SubstrateAccount[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen) {
            loadAccounts();
        }
    }, [isOpen]);

    const loadAccounts = async () => {
        setLoading(true);
        setError(null);
        try {
            const { web3Enable, web3Accounts } = await import('@polkadot/extension-dapp');

            const extensions = await web3Enable('ProxySocialHub');
            if (extensions.length === 0) {
                setError("No Substrate extensions found. Please install Subwallet or Bittensor wallet.");
                setLoading(false);
                return;
            }

            const allAccounts = await web3Accounts();
            if (allAccounts.length === 0) {
                setError("No accounts found. Please unlock your wallet and allow access.");
                setLoading(false);
                return;
            }

            setAccounts(allAccounts);
        } catch (err) {
            console.error("Failed to load Substrate accounts:", err);
            setError("Failed to connect to wallet extensions.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-md bg-zinc-950 border-zinc-800 text-zinc-100">
                <DialogHeader>
                    <DialogTitle className="text-xl font-bold font-mono tracking-tight uppercase">
                        Select TAO Wallet
                    </DialogTitle>
                    <DialogDescription className="text-zinc-400 font-mono text-xs uppercase">
                        Choose an account from your Substrate extensions
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-3 mt-4 max-h-[400px] overflow-y-auto pr-1 custom-scrollbar">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-10 space-y-4">
                            <Loader2 className="w-8 h-8 animate-spin text-primary" />
                            <p className="text-xs font-mono text-zinc-500 animate-pulse">DETECTING EXTENSIONS...</p>
                        </div>
                    ) : error ? (
                        <div className="p-4 border border-destructive/20 bg-destructive/5 rounded-sm space-y-3">
                            <p className="text-xs text-destructive font-mono">{error}</p>
                            <div className="flex flex-wrap gap-2">
                                <a
                                    href="https://subwallet.app/"
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-[10px] flex items-center gap-1 text-zinc-400 hover:text-zinc-200 underline"
                                >
                                    GET SUBWALLET <ExternalLink size={10} />
                                </a>
                                <a
                                    href="https://bittensor.com/wallet"
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-[10px] flex items-center gap-1 text-zinc-400 hover:text-zinc-200 underline"
                                >
                                    GET BITTENSOR WALLET <ExternalLink size={10} />
                                </a>
                            </div>
                        </div>
                    ) : (
                        accounts.map((account) => (
                            <button
                                key={account.address}
                                onClick={() => onSelect(account)}
                                className="w-full flex items-center justify-between p-4 border border-zinc-800 bg-zinc-900/50 hover:bg-primary/10 hover:border-primary/30 transition-all group rounded-sm"
                            >
                                <div className="flex items-center gap-4 text-left">
                                    <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                                        <Wallet className="w-5 h-5 text-zinc-400 group-hover:text-primary" />
                                    </div>
                                    <div>
                                        <h4 className="text-xs font-bold font-mono uppercase text-zinc-200 group-hover:text-primary">
                                            {account.meta.name || "UNNAMED ACCOUNT"}
                                        </h4>
                                        <p className="text-[10px] font-mono text-zinc-500 break-all">
                                            {account.address.slice(0, 10)}...{account.address.slice(-10)}
                                        </p>
                                        <span className="text-[9px] font-mono p-0.5 px-1.5 bg-zinc-800 rounded-full text-zinc-400 mt-1 inline-block uppercase">
                                            VIA {account.meta.source}
                                        </span>
                                    </div>
                                </div>
                                <CheckCircle className="w-5 h-5 text-primary opacity-0 group-hover:opacity-100 transition-opacity" />
                            </button>
                        ))
                    )}
                </div>

                <div className="mt-4 pt-4 border-t border-zinc-900">
                    <p className="text-[9px] font-mono text-zinc-600 uppercase text-center">
                        Secure SR25519/ED25519 Authentication
                    </p>
                </div>
            </DialogContent>
        </Dialog>
    );
};
