'use client';

import { useState, type Dispatch, type SetStateAction } from 'react';
import type { useWallet as useSolanaWallet } from '@solana/wallet-adapter-react';
import { withdrawWallet } from '@/lib/api';
import { signWithdrawalMessage } from '@/lib/solana-message-sign';
import { getSolscanTxUrl } from '@/lib/solscan';
import { getErrorMessage } from '@/lib/utils';
import type { QueryClient } from '@tanstack/react-query';
import type { WalletResult } from '../types';

type SolanaWallet = ReturnType<typeof useSolanaWallet>;

type WalletLike = {
  linked_solana_address?: string | null;
  balance_sol?: number | string | null;
} | null | undefined;

export function useWalletWithdraw(opts: {
  wallet: WalletLike;
  connected: boolean;
  publicKey: SolanaWallet['publicKey'];
  signMessage: SolanaWallet['signMessage'];
  largeWithdrawThresholdSOL: number;
  processing: boolean;
  setProcessing: Dispatch<SetStateAction<boolean>>;
  setResult: Dispatch<SetStateAction<WalletResult | null>>;
  queryClient: QueryClient;
}) {
  const {
    wallet,
    connected,
    publicKey,
    signMessage,
    largeWithdrawThresholdSOL,
    processing,
    setProcessing,
    setResult,
    queryClient,
  } = opts;

  const [withdrawAmount, setWithdrawAmount] = useState('');
  const withdrawRequiresSignature = parseFloat(withdrawAmount) > largeWithdrawThresholdSOL;

  const handleWithdrawSol = async () => {
    if (!wallet?.linked_solana_address) {
      setResult({ success: false, message: 'Link a Solana wallet before withdrawing' });
      return;
    }
    const amt = parseFloat(withdrawAmount);
    if (!amt || amt <= 0) {
      setResult({ success: false, message: 'Enter a valid withdrawal amount' });
      return;
    }
    if (amt > Number(wallet.balance_sol || 0)) {
      setResult({ success: false, message: 'Insufficient custodial balance' });
      return;
    }

    setProcessing(true);
    setResult(null);
    try {
      let opts: { nonce?: string; signature?: string } | undefined;
      if (amt > largeWithdrawThresholdSOL) {
        if (!signMessage || !connected || !publicKey) {
          throw new Error(
            `Withdrawals over ${largeWithdrawThresholdSOL} SOL require wallet signature — connect Phantom/Solflare`
          );
        }
        const linked = wallet.linked_solana_address;
        if (publicKey.toBase58() !== linked) {
          throw new Error(
            `Connected wallet must match your linked address (${linked.slice(0, 4)}…${linked.slice(-4)})`
          );
        }
        opts = await signWithdrawalMessage(signMessage, amt);
      }
      const res = await withdrawWallet(amt, '', '', opts);
      const txRef = res.tx_hash || res.reference;
      const processing = res.status === 'processing';
      setResult({
        success: true,
        message: processing
          ? res.message ||
            'Withdrawal submitted — usually completes in under a few minutes'
          : txRef
            ? `Withdrawal submitted (${txRef.slice(0, 12)}…)`
            : 'Withdrawal submitted',
        solscanUrl: processing
          ? undefined
          : res.solscan_url || (txRef ? getSolscanTxUrl(txRef) : undefined),
      });
      setWithdrawAmount('');
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
    } catch (err: unknown) {
      setResult({ success: false, message: getErrorMessage(err) || 'Withdrawal failed' });
    } finally {
      setProcessing(false);
    }
  };

  return {
    withdrawAmount,
    setWithdrawAmount,
    withdrawRequiresSignature,
    processing,
    handleWithdrawSol,
  };
}
