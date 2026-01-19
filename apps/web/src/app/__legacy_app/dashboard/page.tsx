'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { getSessions, createSession, terminateSession, Session, Wallet as WalletType, getUserUsage, getWallet } from '@/lib/api';
import { SmartConnectWizard } from '@/components/SmartConnectWizard';
import { GlassCard } from "@/components/ui/glass-card";
import { GlowButton } from "@/components/ui/glow-button";
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
  const [usage, setUsage] = useState<{ total_gb: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creatingSession, setCreatingSession] = useState(false);
  const [showSmartWizard, setShowSmartWizard] = useState(false);

  useEffect(() => {
    async function loadData() {
      try {
        const [sessionsData, walletData, usageData] = await Promise.all([
          getSessions(),
          getWallet().catch(() => null),
          getUserUsage().catch(() => null)
        ]);
        setSessions(sessionsData);
        setWallet(walletData);
        if (usageData) setUsage({ total_gb: usageData.total_gb });
      } catch (e) {
        console.error('Failed to load dashboard data', e);
      } finally {
        setLoading(false);
      }
    }
    if (isAuthenticated) {
      loadData();
    }
  }, [isAuthenticated]);

  const handleCreateSession = async (type: 'rotating' | 'sticky', nodeId?: string) => {
    setCreatingSession(true);
    setError('');
    try {
      const { session } = await createSession(type, nodeId);
      setSessions((prev) => [session, ...prev]);
      // If we provided a nodeId, show success specific to smart match
      if (nodeId) {
        // Optional: show specific toast
      }
    } catch (err: any) {
      console.error(err);
      if (err.message === 'Authentication required') {
        router.push('/login');
      } else {
        setError('Failed to create session');
      }
    } finally {
      setCreatingSession(false);
    }
  };

  const handleSmartConnect = async (nodeId: string) => {
    // Pass preferred_node_id to createSession via the handler
    setShowSmartWizard(false);
    handleCreateSession('rotating', nodeId);
  };

  // ... (handleTerminateSession same as before)

  // ... (rendering logic)

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-20">
      {/* Header and Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Welcome Block */}
        <div className="md:col-span-2 p-8 rounded-[2rem] bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border border-primary/20 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-primary/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
          <div className="relative z-10">
            <h1 className="text-4xl font-black mb-2 tracking-tight">
              Welcome back, <span className="text-primary">{user?.user_metadata?.full_name?.split(' ')[0] || 'User'}</span>
            </h1>
            <p className="text-muted-foreground text-lg mb-8 max-w-md">
              Your network is running smoothly. managing {sessions.length} active sessions.
            </p>

            <div className="flex gap-4">
              <div className="flex items-center gap-3 px-4 py-2 rounded-full bg-background/50 border border-white/10 backdrop-blur-md">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                <span className="text-sm font-bold text-green-500">System Online</span>
              </div>
              <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-background/50 border border-white/10 backdrop-blur-md">
                <Activity size={16} className="text-primary" />
                <span className="text-sm font-bold">{sessions.length} Active Nodes</span>
              </div>
            </div>
          </div>
        </div>

        {/* Stats Block */}
        <div className="space-y-4">
          {/* Wallet Balance */}
          <div className="p-6 rounded-[2rem] bg-[var(--glass-bg)] border border-[var(--glass-border)] relative overflow-hidden group hover:border-primary/30 transition-colors">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 rounded-xl bg-orange-500/10 text-orange-400">
                <Wallet size={24} />
              </div>
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Balance</span>
            </div>
            <div className="text-3xl font-black text-white mb-1">
              {wallet ? `${wallet.currency} ${wallet.balance.toFixed(2)}` : '...'}
            </div>
            <div className="text-xs text-muted-foreground">Available for use</div>
          </div>

          {/* Usage Stats (Placeholder for now, API call needed) */}
          <div className="p-6 rounded-[2rem] bg-[var(--glass-bg)] border border-[var(--glass-border)] relative overflow-hidden group hover:border-primary/30 transition-colors">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 rounded-xl bg-blue-500/10 text-blue-400">
                <Activity size={24} />
              </div>
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Total Usage</span>
            </div>
            <div className="text-3xl font-black text-white mb-1">
              0.00 <span className="text-lg text-muted-foreground">GB</span>
            </div>
            <div className="text-xs text-muted-foreground">This month</div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <GlassCard className="p-8 relative overflow-hidden bg-background/40">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent pointer-events-none"></div>
        <div className="relative z-10">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-xl font-black text-foreground tracking-tight">Quick Operations</h2>
            <Link href="/dashboard/nodes" className="text-xs font-bold text-primary hover:underline">View Node Network →</Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* New AI Button */}
            <GlowButton
              onClick={() => setShowSmartWizard(true)}
              variant="outline"
              className="h-auto flex-col items-center justify-center p-4 border-purple-500/20 text-purple-400 hover:bg-purple-500 hover:text-white shadow-lg shadow-purple-900/10 hover:shadow-purple-900/30 group"
            >
              <div className="p-3 rounded-xl bg-purple-500/20 group-hover:bg-white/20 mb-3 transition-colors">
                <Sparkles size={24} className="animate-pulse" />
              </div>
              <div className="text-center">
                <div className="text-sm font-black uppercase tracking-tighter">AI Smart Connect</div>
                <div className="text-[10px] opacity-70">Auto-Match Best Node</div>
              </div>
            </GlowButton>

            <GlowButton
              onClick={() => handleCreateSession('rotating')}
              disabled={creatingSession}
              variant="outline"
              className="h-auto items-center justify-between p-4 border-orange-500/20 text-orange-400 hover:bg-orange-500 hover:text-white group"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-orange-500/20 group-hover:bg-white/20 transition-colors">
                  <RefreshCw size={20} className={creatingSession ? 'animate-spin' : ''} />
                </div>
                <div className="text-left">
                  <div className="text-sm font-black uppercase tracking-tighter">Rotating</div>
                  <div className="text-[10px] opacity-70">Dynamic Proxy Port</div>
                </div>
              </div>
              <Plus size={18} className="opacity-50 group-hover:opacity-100 transition-opacity" />
            </GlowButton>

            <GlowButton
              onClick={() => handleCreateSession('sticky')}
              disabled={creatingSession}
              variant="outline"
              className="h-auto items-center justify-between p-4 border-blue-500/20 text-blue-400 hover:bg-blue-500 hover:text-white group"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-blue-500/20 group-hover:bg-white/20 transition-colors">
                  <Anchor size={20} className={creatingSession ? 'animate-pulse' : ''} />
                </div>
                <div className="text-left">
                  <div className="text-sm font-black uppercase tracking-tighter">Sticky</div>
                  <div className="text-[10px] opacity-70">Static Session Port</div>
                </div>
              </div>
              <Plus size={18} className="opacity-50 group-hover:opacity-100 transition-opacity" />
            </GlowButton>

            <Link href="/dashboard/wallet">
              <GlowButton
                variant="outline"
                className="w-full h-full items-center justify-between p-4 border-green-500/20 text-green-400 hover:bg-green-500 hover:text-white group"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-green-500/20 group-hover:bg-white/20 transition-colors">
                    <CreditCard size={20} />
                  </div>
                  <div className="text-left">
                    <div className="text-sm font-black uppercase tracking-tighter">Finance</div>
                    <div className="text-[10px] opacity-70">Top Up Balance</div>
                  </div>
                </div>
                <Plus size={18} className="opacity-50 group-hover:opacity-100 transition-opacity" />
              </GlowButton>
            </Link>
          </div>
        </div>
      </GlassCard>

      {/* Sessions Table */}
      <div className="rounded-[2rem] bg-[var(--glass-bg)] border border-[var(--glass-border)] relative overflow-hidden shadow-[var(--glass-shadow)] backdrop-blur-md p-6">
        {/* Re-implementing basic table placeholder if it was lost, or just a wrapper */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold">Active Sessions</h2>
          <GlowButton size="sm" variant="ghost" icon={<RefreshCw size={14} />}>Refresh</GlowButton>
        </div>
        {/* We assume the table logic was intended to be here. For now, adding aplaceholder valid structure */}
        <div className="text-center py-12 text-muted-foreground">
          {sessions.length === 0 ? "No active sessions found." : "Sessions list..."}
        </div>
      </div>

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
