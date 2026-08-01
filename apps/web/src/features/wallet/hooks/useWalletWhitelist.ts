'use client';

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { updateWithdrawalWhitelist } from '@/lib/api';
import { getErrorMessage } from '@/lib/utils';
import type { WalletResult } from '../types';

type WithdrawalSecurityLike = {
  withdrawal_whitelist?: string[] | null;
} | null | undefined;

export function useWalletWhitelist(opts: {
  withdrawalSecurity: WithdrawalSecurityLike;
  refetchWithdrawalSecurity: () => void;
  setResult: Dispatch<SetStateAction<WalletResult | null>>;
}) {
  const { withdrawalSecurity, refetchWithdrawalSecurity, setResult } = opts;
  const [whitelistDraft, setWhitelistDraft] = useState('');
  const [whitelistSaving, setWhitelistSaving] = useState(false);

  useEffect(() => {
    if (withdrawalSecurity?.withdrawal_whitelist) {
      setWhitelistDraft(withdrawalSecurity.withdrawal_whitelist.join('\n'));
    }
  }, [withdrawalSecurity?.withdrawal_whitelist]);

  const handleSaveWhitelist = async () => {
    const addresses = whitelistDraft
      .split(/[\n,]+/)
      .map((a) => a.trim())
      .filter(Boolean);
    setWhitelistSaving(true);
    setResult(null);
    try {
      await updateWithdrawalWhitelist(addresses);
      setResult({ success: true, message: 'Withdrawal whitelist updated' });
      refetchWithdrawalSecurity();
    } catch (err: unknown) {
      setResult({ success: false, message: getErrorMessage(err) || 'Failed to update whitelist' });
    } finally {
      setWhitelistSaving(false);
    }
  };

  return {
    whitelistDraft,
    setWhitelistDraft,
    whitelistSaving,
    handleSaveWhitelist,
  };
}
