'use client';

import { useState, type Dispatch, type SetStateAction } from 'react';
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import type { useWallet as useSolanaWallet } from '@solana/wallet-adapter-react';
import { depositCrypto } from '@/lib/api';
import { formatSolanaWalletError, sendSolTransfer } from '@/lib/solana-transfer';
import { getSolscanTxUrl } from '@/lib/solscan';
import { getErrorMessage } from '@/lib/utils';
import type { QueryClient } from '@tanstack/react-query';
import { DEPOSIT_FEE_BUFFER_LAMPORTS } from '../constants';
import type { WalletResult } from '../types';

type SolanaWallet = ReturnType<typeof useSolanaWallet>;

type WalletLike = {
  linked_solana_address?: string | null;
} | null | undefined;

type TreasuryConfigLike = {
  treasury_solana?: string | null;
} | null | undefined;

export function useWalletDeposit(opts: {
  wallet: WalletLike;
  treasuryConfig: TreasuryConfigLike;
  connected: boolean;
  publicKey: SolanaWallet['publicKey'];
  signTransaction: SolanaWallet['signTransaction'];
  sendTransaction: SolanaWallet['sendTransaction'];
  processing: boolean;
  setProcessing: Dispatch<SetStateAction<boolean>>;
  setResult: Dispatch<SetStateAction<WalletResult | null>>;
  queryClient: QueryClient;
}) {
  const {
    wallet,
    treasuryConfig,
    connected,
    publicKey,
    signTransaction,
    sendTransaction,
    processing,
    setProcessing,
    setResult,
    queryClient,
  } = opts;

  const [depositAmount, setDepositAmount] = useState('');
  const [depositTxHash, setDepositTxHash] = useState('');
  const [showManualDeposit, setShowManualDeposit] = useState(false);
  const [showDepositConfirm, setShowDepositConfirm] = useState(false);
  const [depositConfirmAmount, setDepositConfirmAmount] = useState<number | null>(null);

  const creditDepositOnServer = async (amt: number, signature: string) => {
    const res = await depositCrypto(amt, signature, 'solana');
    const solscan = res.solscan_url || getSolscanTxUrl(signature);
    setResult({
      success: true,
      message:
        res.message ||
        `Deposit credited${res.credited_sol != null ? `: ${res.credited_sol} SOL` : ''}`,
      solscanUrl: solscan,
    });
    setDepositAmount('');
    setDepositTxHash('');
    queryClient.invalidateQueries({ queryKey: ['wallet'] });
  };

  const handleDepositVerify = async () => {
    const amt = parseFloat(depositAmount);
    const txHash = depositTxHash.trim();
    if (!amt || amt <= 0 || !txHash) {
      setResult({ success: false, message: 'Enter deposit amount and transaction signature' });
      return;
    }
    if (!wallet?.linked_solana_address) {
      setResult({ success: false, message: 'Link a Solana wallet before verifying a deposit' });
      return;
    }
    setProcessing(true);
    setResult(null);
    try {
      await creditDepositOnServer(amt, txHash);
    } catch (err: unknown) {
      setResult({ success: false, message: getErrorMessage(err) || 'Deposit verification failed' });
    } finally {
      setProcessing(false);
    }
  };

  const initiateDeposit = () => {
    const amt = parseFloat(depositAmount);
    if (!amt || amt <= 0) {
      setResult({ success: false, message: 'Enter a valid deposit amount' });
      return;
    }
    if (!wallet?.linked_solana_address) {
      setResult({ success: false, message: 'Link a Solana wallet first (Linked Wallets tab)' });
      return;
    }
    setDepositConfirmAmount(amt);
    setShowDepositConfirm(true);
  };

  const handleDepositSol = async () => {
    const amt = parseFloat(depositAmount);
    if (!amt || amt <= 0) {
      setResult({ success: false, message: 'Enter a valid deposit amount' });
      return;
    }
    const treasury = treasuryConfig?.treasury_solana;
    if (!treasury) {
      setResult({
        success: false,
        message: treasuryConfig
          ? 'Platform treasury is not configured. Deposits are unavailable until an admin sets SOLANA_TREASURY_ADDRESS.'
          : 'Treasury address is still loading — try again in a moment',
      });
      return;
    }
    if (!wallet?.linked_solana_address) {
      setResult({ success: false, message: 'Link a Solana wallet first (Linked Wallets tab)' });
      return;
    }
    if (!connected || !publicKey || (!signTransaction && !sendTransaction)) {
      setResult({
        success: false,
        message: 'Connect your linked Solana wallet below, then deposit again',
      });
      return;
    }
    const linked = wallet.linked_solana_address;
    if (publicKey.toBase58() !== linked) {
      setResult({
        success: false,
        message: `Connected wallet must match your linked address (${linked.slice(0, 4)}…${linked.slice(-4)})`,
      });
      return;
    }

    setProcessing(true);
    setResult(null);
    try {
      const { getConnection } = await import('@/lib/solana');
      const connection = getConnection();
      const treasuryPk = new PublicKey(treasury);
      const lamports = Math.round(amt * LAMPORTS_PER_SOL);
      if (lamports <= 0) {
        throw new Error('Amount is too small');
      }

      const balance = await connection.getBalance(publicKey);
      const feeBuffer = DEPOSIT_FEE_BUFFER_LAMPORTS;
      if (balance < lamports + feeBuffer) {
        setResult({
          success: false,
          message: `Not enough SOL in your wallet (need ~${amt} SOL plus network fee)`,
        });
        return;
      }

      setResult({ success: true, message: 'Approve the transfer in your wallet…', type: 'info' });
      const signature = await sendSolTransfer(
        connection,
        {
          publicKey,
          signTransaction,
          sendTransaction,
        },
        treasuryPk,
        lamports
      );

      setResult({ success: true, message: 'Transaction confirmed — crediting balance…', type: 'info' });
      await creditDepositOnServer(amt, signature);
    } catch (err: unknown) {
      setResult({ success: false, message: formatSolanaWalletError(err) });
    } finally {
      setProcessing(false);
    }
  };

  const copyTreasuryAddress = async () => {
    const addr = treasuryConfig?.treasury_solana;
    if (!addr) return;
    await navigator.clipboard.writeText(addr);
    setResult({ success: true, message: 'Treasury address copied' });
  };

  return {
    depositAmount,
    setDepositAmount,
    depositTxHash,
    setDepositTxHash,
    showManualDeposit,
    setShowManualDeposit,
    showDepositConfirm,
    setShowDepositConfirm,
    depositConfirmAmount,
    setDepositConfirmAmount,
    processing,
    initiateDeposit,
    handleDepositSol,
    handleDepositVerify,
    copyTreasuryAddress,
  };
}
