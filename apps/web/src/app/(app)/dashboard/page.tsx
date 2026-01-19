'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { getSessions, terminateSession, Session, Wallet as WalletType, getUserUsage } from '@/lib/api';
import { SmartConnectWizard } from '@/components/SmartConnectWizard';
import {
  Wallet,
  Activity,
  Layers,
  Shield,
  RefreshCw,
  Anchor,
  CreditCard,
  Power,
  Clock,
  Key,
  AlertCircle,
  Plus,
  Sparkles,
  Package,
  ArrowRight
} from 'lucide-react';

export default function DashboardPage() {
  const { user, isLoading, isAuthenticated } = useAuth();
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [wallet, setWallet] = useState<WalletType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creatingSession, setCreatingSession] = useState(false);
  const [showSmartWizard, setShowSmartWizard] = useState(false);

  // ... (useEffect and loadData same as before) 

  const handleCreateSession = async (type: 'rotating' | 'sticky') => {
    // ... same as before
  };

  const handleSmartConnect = async (nodeId: string) => {
    // For now, selecting a node just creates a standard rotating session on that node (mocked)
    // In future, we pass preferred_node_id to createSession
    setShowSmartWizard(false);
    handleCreateSession('rotating');
  };

  // ... (handleTerminateSession same as before)

  // ... (rendering logic)

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-20">
      {/* Header and Stats same as before */}

      {/* Quick Actions */}
      <div className="p-8 rounded-[2rem] bg-[var(--glass-bg)] border border-[var(--glass-border)] relative overflow-hidden shadow-[var(--glass-shadow)]">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent"></div>
        <div className="relative z-10">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-xl font-black text-white tracking-tight">Quick Operations</h2>
            <Link href="/dashboard/nodes" className="text-xs font-bold text-primary hover:underline">View Node Network →</Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* New AI Button */}
            <button
              onClick={() => setShowSmartWizard(true)}
              className="group flex flex-col items-center justify-center p-4 rounded-2xl bg-gradient-to-br from-purple-600/20 to-indigo-600/20 border border-purple-500/20 text-purple-300 hover:from-purple-600 hover:to-indigo-600 hover:text-white transition-all duration-300 shadow-lg shadow-purple-900/10 hover:shadow-purple-900/30"
            >
              <div className="p-3 rounded-xl bg-purple-500/20 group-hover:bg-white/20 mb-3">
                <Sparkles size={24} className="animate-pulse" />
              </div>
              <div className="text-center">
                <div className="text-sm font-black uppercase tracking-tighter">AI Smart Connect</div>
                <div className="text-[10px] opacity-70">Auto-Match Best Node</div>
              </div>
            </button>

            <button
              onClick={() => handleCreateSession('rotating')}
              disabled={creatingSession}
              className="group flex items-center justify-between p-4 rounded-2xl bg-orange-500/10 border border-orange-500/20 text-orange-400 hover:bg-orange-500 hover:text-white transition-all duration-300 disabled:opacity-50"
            >
              {/* ... Rotating Button Content ... */}
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-orange-500/20 group-hover:bg-white/20">
                  <RefreshCw size={20} className={creatingSession ? 'animate-spin' : ''} />
                </div>
                <div className="text-left">
                  <div className="text-sm font-black uppercase tracking-tighter">Rotating</div>
                  <div className="text-[10px] opacity-70">Dynamic Proxy Port</div>
                </div>
              </div>
              <Plus size={18} className="opacity-50 group-hover:opacity-100" />
            </button>

            <button
              onClick={() => handleCreateSession('sticky')}
              disabled={creatingSession}
              className="group flex items-center justify-between p-4 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-400 hover:bg-blue-500 hover:text-white transition-all duration-300 disabled:opacity-50"
            >
              {/* ... Sticky Button Content ... */}
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-blue-500/20 group-hover:bg-white/20">
                  <Anchor size={20} className={creatingSession ? 'animate-pulse' : ''} />
                </div>
                <div className="text-left">
                  <div className="text-sm font-black uppercase tracking-tighter">Sticky</div>
                  <div className="text-[10px] opacity-70">Static Session Port</div>
                </div>
              </div>
              <Plus size={18} className="opacity-50 group-hover:opacity-100" />
            </button>

            <Link
              href="/dashboard/wallet"
              className="group flex items-center justify-between p-4 rounded-2xl bg-green-500/10 border border-green-500/20 text-green-400 hover:bg-green-500 hover:text-white transition-all duration-300"
            >
              {/* ... Wallet Button Content ... */}
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-green-500/20 group-hover:bg-white/20">
                  <CreditCard size={20} />
                </div>
                <div className="text-left">
                  <div className="text-sm font-black uppercase tracking-tighter">Finance</div>
                  <div className="text-[10px] opacity-70">Top Up Balance</div>
                </div>
              </div>
              <Plus size={18} className="opacity-50 group-hover:opacity-100" />
            </Link>

            <Link
              href="/dashboard/orders"
              className="group flex items-center justify-between p-4 rounded-2xl bg-pink-500/10 border border-pink-500/20 text-pink-400 hover:bg-pink-500 hover:text-white transition-all duration-300"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-pink-500/20 group-hover:bg-white/20">
                  <Package size={20} />
                </div>
                <div className="text-left">
                  <div className="text-sm font-black uppercase tracking-tighter">My Orders</div>
                  <div className="text-[10px] opacity-70">Track Purchases</div>
                </div>
              </div>
              <ArrowRight size={18} className="opacity-50 group-hover:opacity-100" />
            </Link>
          </div>
        </div>
      </div>

      {/* Sessions Table (Unchanged) */}
      {/* ... */}

      {/* Wizard Modal */}
      {showSmartWizard && (
        <SmartConnectWizard
          onClose={() => setShowSmartWizard(false)}
          onConnect={handleSmartConnect}
        />
      )}
    </div>
  );
}
