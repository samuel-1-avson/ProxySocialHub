'use client';

import { type Dispatch, type SetStateAction } from 'react';
import type { useWallet as useSolanaWallet } from '@solana/wallet-adapter-react';
import bs58 from 'bs58';
import { getLinkChallenge, linkWallet } from '@/lib/api';
import { getErrorMessage } from '@/lib/utils';
import type { QueryClient } from '@tanstack/react-query';
import type { WalletResult } from '../types';

type SolanaWallet = ReturnType<typeof useSolanaWallet>;

export function useWalletLinking(opts: {
  userId: string | undefined;
  publicKey: SolanaWallet['publicKey'];
  signMessage: SolanaWallet['signMessage'];
  processing: boolean;
  setProcessing: Dispatch<SetStateAction<boolean>>;
  setResult: Dispatch<SetStateAction<WalletResult | null>>;
  queryClient: QueryClient;
  solanaRpcUrl: string;
  linkedAddress: string | null | undefined;
}) {
  const {
    userId,
    publicKey,
    signMessage,
    setProcessing,
    setResult,
    queryClient,
    solanaRpcUrl,
    linkedAddress,
  } = opts;

  const buildCliBalanceCommand = (address: string) =>
    `solana balance ${address} --url ${solanaRpcUrl}`;

  const copyLinkedAddress = async () => {
    const addr = linkedAddress;
    if (!addr) return;
    await navigator.clipboard.writeText(addr);
    setResult({ success: true, message: 'Linked address copied' });
  };

  const copyCliBalanceCheck = async () => {
    const addr = linkedAddress;
    if (!addr) return;
    await navigator.clipboard.writeText(buildCliBalanceCommand(addr));
    setResult({ success: true, message: 'CLI balance command copied' });
  };

  const handleLinkSolana = async () => {
    if (!publicKey || !userId || !signMessage) return;
    setProcessing(true);
    try {
      // P0-4: sign the server-issued single-use challenge (binds user+wallet+nonce).
      const challenge = await getLinkChallenge(publicKey.toBase58(), 'solana');
      const message = challenge.message;
      const encodedMessage = new TextEncoder().encode(message);
      const sigBytes = await signMessage(encodedMessage);
      const signature = bs58.encode(sigBytes);

      await linkWallet(publicKey.toBase58(), 'solana', signature, message);
      setResult({ success: true, message: 'Solana Wallet Linked' });
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
    } catch (err: unknown) {
      setResult({ success: false, message: getErrorMessage(err) || 'Linking failed' });
    } finally {
      setProcessing(false);
    }
  };

  const handleUnlinkSolana = async (
    setLinkedWalletBalance: Dispatch<SetStateAction<number | null>>
  ) => {
    setProcessing(true);
    try {
      const { unlinkWallet } = await import('@/lib/api');
      await unlinkWallet('solana');
      setResult({ success: true, message: 'Identity De-coupled' });
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
      queryClient.invalidateQueries({ queryKey: ['withdrawal-security'] });
      setLinkedWalletBalance(null);
    } catch (err: unknown) {
      setResult({ success: false, message: getErrorMessage(err) || 'Unlink failed' });
    } finally {
      setProcessing(false);
    }
  };

  return {
    buildCliBalanceCommand,
    copyLinkedAddress,
    copyCliBalanceCheck,
    handleLinkSolana,
    handleUnlinkSolana,
  };
}
