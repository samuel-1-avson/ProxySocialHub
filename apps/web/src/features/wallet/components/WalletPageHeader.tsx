'use client';

import { Lock, Wallet as WalletIcon } from 'lucide-react';
import { motion } from 'framer-motion';
import type { TabType } from '../types';

type WalletPageHeaderProps = {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
};

const TABS: { id: TabType; label: string }[] = [
  { id: 'OVERVIEW', label: 'Overview' },
  { id: 'DEPOSIT', label: 'Deposit' },
  { id: 'WITHDRAW', label: 'Withdraw' },
  { id: 'ACTIVITY', label: 'Activity' },
  { id: 'LINKED_WALLETS', label: 'Linked' },
];

export function WalletPageHeader({ activeTab, onTabChange }: WalletPageHeaderProps) {
  return (
    <motion.header
      variants={{
        hidden: { opacity: 0, y: 20 },
        show: { opacity: 1, y: 0 },
      }}
      className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 border-b border-white/5 pb-8"
    >
      <div>
        <div className="flex items-center gap-2 text-primary font-mono text-[10px] font-black uppercase tracking-[0.3em] mb-1">
          <Lock size={12} className="animate-pulse" /> Secure Financial Sector
        </div>
        <h1 className="text-4xl font-black font-mono uppercase tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-primary to-emerald-400 flex items-center gap-3">
          <WalletIcon size={32} className="text-primary" /> Financial HQ
        </h1>
      </div>

      <div
        role="tablist"
        aria-label="Wallet sections"
        className="flex flex-wrap bg-white/5 p-1.5 rounded-xl border border-white/10 backdrop-blur-md"
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`px-3 py-2 text-[10px] font-mono font-black uppercase transition-all rounded-lg ${
              activeTab === tab.id
                ? 'bg-primary text-primary-foreground shadow-lg'
                : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </motion.header>
  );
}
