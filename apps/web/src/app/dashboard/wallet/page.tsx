'use client';

import { useState } from 'react';
import { useWallet as useSolanaWallet } from '@solana/wallet-adapter-react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { getErrorMessage } from '@/lib/utils';
import {
  type TabType,
  useWalletPageData,
  useSolanaBalances,
  useWalletDeposit,
  useWalletWithdraw,
  useWalletWhitelist,
  useWalletLinking,
  WalletPageHeader,
  WalletOverview,
  WalletDeposit,
  WalletWithdraw,
  WalletActivity,
  WalletLinkedWallets,
  WalletSidebar,
  WalletOnChainHint,
  WalletResultBanner,
} from '@/features/wallet';

export default function UnifiedWalletPage() {
  const [activeTab, setActiveTab] = useState<TabType>('OVERVIEW');
  const { connected, publicKey, signMessage, signTransaction, sendTransaction, disconnect } =
    useSolanaWallet();

  const page = useWalletPageData();
  const {
    user,
    queryClient,
    processing,
    setProcessing,
    result,
    setResult,
    mounted,
    wallet,
    loading,
    walletError,
    treasuryConfig,
    withdrawalSecurity,
    refetchWithdrawalSecurity,
    largeWithdrawThresholdSOL,
    solanaNetwork,
    isDevnet,
    isLocalSolanaRpc,
    solanaRpcUrl,
  } = page;

  const { linkedWalletBalance, setLinkedWalletBalance } = useSolanaBalances({
    connected,
    publicKey,
    linkedAddress: wallet?.linked_solana_address,
  });

  const deposit = useWalletDeposit({
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
  });

  const withdraw = useWalletWithdraw({
    wallet,
    connected,
    publicKey,
    signMessage,
    largeWithdrawThresholdSOL,
    processing,
    setProcessing,
    setResult,
    queryClient,
  });

  const whitelist = useWalletWhitelist({
    withdrawalSecurity,
    refetchWithdrawalSecurity,
    setResult,
  });

  const linking = useWalletLinking({
    userId: user?.id,
    publicKey,
    signMessage,
    processing,
    setProcessing,
    setResult,
    queryClient,
    solanaRpcUrl,
    linkedAddress: wallet?.linked_solana_address,
  });

  if (!mounted) return null;

  const onChainHint =
    wallet?.linked_solana_address ? (
      <WalletOnChainHint
        linkedAddress={wallet.linked_solana_address}
        isLocalSolanaRpc={isLocalSolanaRpc}
        isDevnet={isDevnet}
        cliBalanceCommand={linking.buildCliBalanceCommand(wallet.linked_solana_address)}
        onCopyAddress={linking.copyLinkedAddress}
        onCopyCliCommand={linking.copyCliBalanceCheck}
      />
    ) : null;

  return (
    <motion.div
      variants={{
        hidden: { opacity: 0 },
        show: { opacity: 1, transition: { staggerChildren: 0.1 } },
      }}
      initial="hidden"
      animate="show"
      className="space-y-8 pb-20"
    >
      <WalletPageHeader activeTab={activeTab} onTabChange={setActiveTab} />

      {walletError ? (
        <div className="flex flex-col items-center justify-center py-32 space-y-6 max-w-md mx-auto text-center font-mono">
          <AlertCircle className="w-12 h-12 text-rose-500" />
          <div className="space-y-2">
            <p className="text-xs font-black uppercase tracking-widest text-foreground">
              Failed to Synchronize Ledger
            </p>
            <p className="text-[10px] text-muted-foreground leading-relaxed uppercase font-bold">
              {getErrorMessage(walletError) ||
                'The platform was unable to load your wallet and transaction history.'}
            </p>
          </div>
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ['wallet'] })}
            className="px-6 py-2.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 border border-rose-500/20 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all"
          >
            Retry Connection
          </button>
        </div>
      ) : loading ? (
        <div className="flex flex-col items-center justify-center py-32 space-y-4">
          <Loader2 className="w-10 h-10 animate-spin text-primary" />
          <p className="font-mono text-[10px] font-black uppercase tracking-widest text-muted-foreground animate-pulse">
            Synchronizing Ledger...
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-8 space-y-8">
            <AnimatePresence mode="wait">
              {activeTab === 'OVERVIEW' && (
                <WalletOverview
                  wallet={wallet}
                  linkedWalletBalance={linkedWalletBalance}
                  connected={connected}
                  isLocalSolanaRpc={isLocalSolanaRpc}
                  isDevnet={isDevnet}
                  solanaRpcUrl={solanaRpcUrl}
                  localRpcHint={onChainHint}
                  onGoToLinkedWallets={() => setActiveTab('LINKED_WALLETS')}
                  onGoToDeposit={() => setActiveTab('DEPOSIT')}
                  onGoToWithdraw={() => setActiveTab('WITHDRAW')}
                  result={result}
                />
              )}

              {activeTab === 'DEPOSIT' && (
                <motion.div
                  key="deposit"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="space-y-6"
                >
                  {result && <WalletResultBanner result={result} variant="overview" />}
                  <div className="glass-card p-6 border-white/5 bg-white/2">
                    <WalletDeposit
                      depositAmount={deposit.depositAmount}
                      onDepositAmountChange={deposit.setDepositAmount}
                      depositTxHash={deposit.depositTxHash}
                      onDepositTxHashChange={deposit.setDepositTxHash}
                      showManualDeposit={deposit.showManualDeposit}
                      onToggleManualDeposit={() => deposit.setShowManualDeposit((v) => !v)}
                      processing={processing}
                      linkedAddress={wallet?.linked_solana_address}
                      connected={connected}
                      isLocalSolanaRpc={isLocalSolanaRpc}
                      isDevnet={isDevnet}
                      treasuryAddress={treasuryConfig?.treasury_solana}
                      onCopyTreasury={deposit.copyTreasuryAddress}
                      onInitiateDeposit={deposit.initiateDeposit}
                      onVerifyDeposit={deposit.handleDepositVerify}
                      showDepositConfirm={deposit.showDepositConfirm}
                      depositConfirmAmount={deposit.depositConfirmAmount}
                      solanaNetwork={solanaNetwork}
                      onDepositConfirmOpenChange={(open) => {
                        if (!open) {
                          deposit.setShowDepositConfirm(false);
                          deposit.setDepositConfirmAmount(null);
                        }
                      }}
                      onConfirmDeposit={async () => {
                        deposit.setShowDepositConfirm(false);
                        deposit.setDepositConfirmAmount(null);
                        await deposit.handleDepositSol();
                      }}
                    />
                  </div>
                </motion.div>
              )}

              {activeTab === 'WITHDRAW' && (
                <motion.div
                  key="withdraw"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="space-y-6"
                >
                  {result && <WalletResultBanner result={result} variant="overview" />}
                  <div className="glass-card p-6 border-white/5 bg-white/2">
                    <WalletWithdraw
                      withdrawAmount={withdraw.withdrawAmount}
                      onWithdrawAmountChange={withdraw.setWithdrawAmount}
                      processing={processing}
                      linkedAddress={wallet?.linked_solana_address}
                      largeWithdrawThresholdSOL={largeWithdrawThresholdSOL}
                      withdrawRequiresSignature={withdraw.withdrawRequiresSignature}
                      canSignMessage={!!signMessage}
                      withdrawalSecurity={withdrawalSecurity}
                      onWithdraw={withdraw.handleWithdrawSol}
                    />
                  </div>
                </motion.div>
              )}

              {activeTab === 'ACTIVITY' && (
                <motion.div
                  key="activity"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                >
                  <WalletActivity transactions={wallet?.transactions} />
                </motion.div>
              )}

              {activeTab === 'LINKED_WALLETS' && (
                <WalletLinkedWallets
                  wallet={wallet}
                  connected={connected}
                  processing={processing}
                  onChainHint={onChainHint}
                  onCopyLinkedAddress={linking.copyLinkedAddress}
                  onUnlink={() => linking.handleUnlinkSolana(setLinkedWalletBalance)}
                  onDisconnect={() => disconnect()}
                  onLink={linking.handleLinkSolana}
                  withdrawalSecurity={withdrawalSecurity}
                  whitelistDraft={whitelist.whitelistDraft}
                  onWhitelistDraftChange={whitelist.setWhitelistDraft}
                  whitelistSaving={whitelist.whitelistSaving}
                  onSaveWhitelist={whitelist.handleSaveWhitelist}
                  result={result}
                />
              )}
            </AnimatePresence>
          </div>

          <WalletSidebar
            balanceSol={Number(wallet?.balance_sol ?? 0)}
            linkedAddress={wallet?.linked_solana_address}
          />
        </div>
      )}
    </motion.div>
  );
}
