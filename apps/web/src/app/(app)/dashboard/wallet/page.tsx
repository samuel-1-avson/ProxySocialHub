'use client';

import { useAuth } from '@/lib/auth';
import { useEffect, useState } from 'react';
import { getWallet, depositWallet, withdrawWallet, Wallet as WalletType } from '@/lib/api';
import {
  Wallet,
  CreditCard,
  Smartphone,
  History,
  Zap,
  ArrowUpRight,
  ArrowDownLeft,
  X,
  Info,
  Clock,
  ShieldCheck,
  Plus
} from 'lucide-react';

export default function WalletPage() {
  const { user } = useAuth();
  const [wallet, setWallet] = useState<WalletType | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<'deposit' | 'withdraw' | null>(null);
  const [amount, setAmount] = useState('');
  const [phone, setPhone] = useState('');
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    fetchWallet();
  }, []);

  async function fetchWallet() {
    try {
      const data = await getWallet();
      setWallet(data);
    } catch (error) {
      console.error('Failed to fetch wallet:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeposit(e: React.FormEvent) {
    e.preventDefault();
    if (!user?.email) {
      setResult({ success: false, message: 'User identity not found. Re-establishing connection...' });
      return;
    }

    setProcessing(true);
    setResult(null);
    try {
      const res = await depositWallet(parseFloat(amount), user.email);
      setResult({ success: true, message: 'Redirecting to secure payment nexus...' });

      if (res.authorization_url) {
        window.location.href = res.authorization_url;
      } else {
        setResult({ success: false, message: 'Encryption failure: Failed to generate protocol URL.' });
      }
    } catch (error: any) {
      console.error('Deposit error:', error);
      setResult({ success: false, message: 'Transaction aborted. Please retry the protocol.' });
    } finally {
      setProcessing(false);
    }
  }

  async function handleWithdraw(e: React.FormEvent) {
    e.preventDefault();
    setProcessing(true);
    setResult(null);
    try {
      const res = await withdrawWallet(parseFloat(amount), phone);
      setResult({ success: true, message: `Withdrawal authorized. Syncing balance...` });
      setAmount('');
      setPhone('');
      setTimeout(() => {
        fetchWallet();
        setAction(null);
      }, 3000);
    } catch {
      setResult({ success: false, message: 'Authorization denied. Insufficient resources or invalid target.' });
    } finally {
      setProcessing(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-[400px] flex flex-col items-center justify-center space-y-4">
        <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
        <p className="text-muted-foreground font-medium animate-pulse">Syncing Wallet Data...</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-20">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-4xl font-black text-white tracking-tighter">Financial Hub</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage your protocol credits and transactions.</p>
        </div>
        <div className="hidden md:flex items-center gap-2 px-4 py-2 rounded-2xl bg-white/5 border border-white/10 text-xs font-bold text-muted-foreground">
          <ShieldCheck size={14} className="text-primary" />
          SECURE CONNECTION ACTIVE
        </div>
      </div>

      {/* Main Balance Section */}
      <div className="relative p-10 rounded-[2.5rem] bg-white/[0.03] border border-white/10 overflow-hidden">
        {/* Background Decor */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-primary/10 blur-[120px] rounded-full -translate-y-1/2 translate-x-1/4"></div>
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-primary/5 blur-[80px] rounded-full translate-y-1/2 -translate-x-1/4"></div>

        <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-12">
          <div className="text-center md:text-left">
            <div className="flex items-center justify-center md:justify-start gap-2 mb-4">
              <div className="p-2 rounded-xl bg-white/5 border border-white/10 text-muted-foreground">
                <Wallet size={16} />
              </div>
              <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-50">Available Credits</span>
            </div>
            <div className="text-6xl md:text-7xl font-black text-white tracking-tighter flex items-baseline gap-2">
              <span className="text-3xl opacity-30 font-bold">{wallet?.currency || '₵'}</span>
              {wallet?.balance?.toFixed(2) || '0.00'}
            </div>
            <div className="mt-4 flex items-center justify-center md:justify-start gap-4 text-xs font-bold text-muted-foreground">
              <div className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500"></div>
                Active
              </div>
              <div className="w-1 h-1 rounded-full bg-white/10"></div>
              <span>Protocol: {wallet?.currency || 'GHS'} Mainnet</span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto">
            <button
              onClick={() => { setAction('deposit'); setResult(null); }}
              className="flex-1 md:flex-none group px-8 py-5 rounded-2xl bg-primary text-black font-black uppercase tracking-tight hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-3 shadow-[0_20px_40px_-15px_rgba(var(--primary-rgb),0.3)]"
            >
              <ArrowDownLeft size={20} className="transition-transform group-hover:-translate-x-1 group-hover:translate-y-1" />
              Deposit Funds
            </button>
            <button
              onClick={() => { setAction('withdraw'); setResult(null); }}
              className="flex-1 md:flex-none group px-8 py-5 rounded-2xl bg-white/5 border border-white/10 text-white font-black uppercase tracking-tight hover:bg-white/10 transition-all flex items-center justify-center gap-3"
            >
              <ArrowUpRight size={20} className="transition-transform group-hover:translate-x-1 group-hover:-translate-y-1" />
              Withdraw
            </button>
          </div>
        </div>
      </div>

      {/* Mid Section: History & Pricing */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Transaction History */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between px-4">
            <div className="flex items-center gap-3 text-white font-black uppercase tracking-widest text-sm">
              <History size={18} className="text-primary" />
              Protocol Log
            </div>
            <span className="text-[10px] font-black text-muted-foreground opacity-50">LATEST TRANSACTIONS</span>
          </div>

          <div className="rounded-3xl bg-white/[0.03] border border-white/5 overflow-hidden">
            {(!wallet?.transactions || wallet.transactions.length === 0) ? (
              <div className="p-20 text-center space-y-4">
                <div className="w-16 h-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mx-auto text-white/20">
                  <History size={32} />
                </div>
                <div>
                  <p className="text-white font-black uppercase tracking-tighter">No History Detected</p>
                  <p className="text-muted-foreground text-sm">Your financial protocol log is currently empty.</p>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-white/[0.02]">
                      <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Operation</th>
                      <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Amount</th>
                      <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Status</th>
                      <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {wallet.transactions.map((tx) => (
                      <tr key={tx.id} className="group hover:bg-white/[0.01] transition-colors">
                        <td className="px-6 py-5">
                          <div className="flex flex-col">
                            <span className="text-sm font-bold text-white tracking-tight">{tx.description}</span>
                            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-50">{tx.type}</span>
                          </div>
                        </td>
                        <td className="px-6 py-5">
                          <span className={`text-sm font-black tabular-nums ${tx.amount >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {tx.amount >= 0 ? '+' : ''}{tx.amount.toFixed(2)}
                          </span>
                        </td>
                        <td className="px-6 py-5">
                          <span className="inline-flex px-2 py-0.5 rounded-md bg-white/5 border border-white/5 text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                            Complete
                          </span>
                        </td>
                        <td className="px-6 py-5">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Clock size={12} className="opacity-30" />
                            {new Date(tx.created_at).toLocaleDateString()}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Pricing Info */}
        <div className="space-y-6">
          <div className="flex items-center gap-3 text-white font-black uppercase tracking-widest text-sm px-4">
            <Zap size={18} className="text-primary" />
            Pricing Protocols
          </div>

          <div className="space-y-4">
            {[
              { label: 'Bandwidth', price: '₵0.50', sub: 'per GB of protocol data', icon: Zap, color: 'text-orange-400' },
              { label: 'Min Deposit', price: '₵1.00', sub: 'network entry requirement', icon: ArrowDownLeft, color: 'text-green-400' },
              { label: 'Min Payout', price: '₵5.00', sub: 'external transfer threshold', icon: ArrowUpRight, color: 'text-blue-400' },
            ].map((p, i) => (
              <div key={i} className="p-6 rounded-3xl bg-white/[0.03] border border-white/5 group hover:border-white/10 transition-all">
                <div className="flex items-center justify-between mb-4">
                  <div className={`p-2 rounded-xl bg-white/5 ${p.color}`}>
                    <p.icon size={16} />
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-30">{p.label}</span>
                </div>
                <div className="text-3xl font-black text-white tracking-tighter mb-1">{p.price}</div>
                <div className="text-[10px] font-bold text-muted-foreground uppercase opacity-50">{p.sub}</div>
              </div>
            ))}

            <div className="p-6 rounded-3xl bg-primary/5 border border-primary/10 flex items-start gap-4">
              <Info size={18} className="text-primary shrink-0 mt-0.5" />
              <p className="text-xs font-medium text-white/70 leading-relaxed">
                Prices are dynamically calculated based on network demand and node availability. All transactions are logged on the private ledger.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      {action && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-6 animate-in fade-in duration-300">
          <div className="bg-[#0A0A0B] border border-white/10 rounded-[2.5rem] p-8 md:p-12 max-w-lg w-full relative overflow-hidden animate-in zoom-in-95 duration-300">
            {/* Modal Decor */}
            <div className={`absolute top-0 left-1/2 -translate-x-1/2 w-64 h-32 blur-[100px] opacity-20 ${action === 'deposit' ? 'bg-primary' : 'bg-blue-500'}`}></div>

            <button
              onClick={() => setAction(null)}
              className="absolute top-8 right-8 p-2 rounded-xl bg-white/5 border border-white/10 text-muted-foreground hover:text-white transition-colors z-10"
            >
              <X size={20} />
            </button>

            <div className="relative z-10">
              <div className="flex items-center gap-4 mb-8">
                <div className={`p-3 rounded-2xl ${action === 'deposit' ? 'bg-primary/20 text-primary' : 'bg-blue-500/20 text-blue-500'}`}>
                  {action === 'deposit' ? <CreditCard size={24} /> : <Smartphone size={24} />}
                </div>
                <div>
                  <h3 className="text-2xl font-black text-white tracking-tight">
                    {action === 'deposit' ? 'Protocol Deposit' : 'Network Withdrawal'}
                  </h3>
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest opacity-50">
                    {action === 'deposit' ? 'Initialize credit sequence' : 'Transfer credits to MoMo'}
                  </p>
                </div>
              </div>

              {result && (
                <div className={`mb-8 p-5 rounded-2xl flex items-center gap-4 animate-in slide-in-from-top-2 ${result.success ? 'bg-green-500/10 border border-green-500/20 text-green-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'}`}>
                  {result.success ? <ShieldCheck size={20} /> : <Info size={20} />}
                  <p className="text-sm font-bold tracking-tight">{result.message}</p>
                </div>
              )}

              <form onSubmit={action === 'deposit' ? handleDeposit : handleWithdraw} className="space-y-6">
                <div className="space-y-2">
                  <label className="block text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Credit Amount (₵)</label>
                  <div className="relative group">
                    <div className="absolute left-5 top-1/2 -translate-y-1/2 text-white/20 font-black text-lg group-focus-within:text-primary transition-colors">₵</div>
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder={action === 'deposit' ? 'Min 1.00' : 'Min 5.00'}
                      min={action === 'deposit' ? 1 : 5}
                      step="0.01"
                      required
                      className="w-full bg-white/5 border border-white/10 rounded-2xl py-5 pl-12 pr-6 text-xl font-black text-white outline-none focus:border-primary/50 focus:bg-white/[0.08] transition-all"
                    />
                  </div>
                </div>

                {action === 'withdraw' && (
                  <div className="space-y-2 animate-in fade-in slide-in-from-top-4">
                    <label className="block text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Mobile Money Identifier</label>
                    <div className="relative group">
                      <Smartphone className="absolute left-5 top-1/2 -translate-y-1/2 text-white/20 group-focus-within:text-blue-500 transition-colors" size={20} />
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="e.g. 05XXXXXXX"
                        required
                        className="w-full bg-white/5 border border-white/10 rounded-2xl py-5 pl-14 pr-6 text-xl font-black text-white outline-none focus:border-blue-500/50 focus:bg-white/[0.08] transition-all"
                      />
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={processing}
                  className={`w-full py-6 rounded-2xl font-black uppercase tracking-widest text-sm transition-all flex items-center justify-center gap-3 disabled:opacity-50 ${action === 'deposit'
                      ? 'bg-primary text-black hover:scale-[1.02]'
                      : 'bg-blue-600 text-white hover:bg-blue-500'
                    }`}
                >
                  {processing ? (
                    <>
                      <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
                      Processing...
                    </>
                  ) : (
                    <>
                      {action === 'deposit' ? 'Authorize Payment' : 'Confirm Transfer'}
                      <Plus size={18} />
                    </>
                  )}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
