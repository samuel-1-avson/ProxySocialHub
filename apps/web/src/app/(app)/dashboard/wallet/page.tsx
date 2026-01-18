'use client';

import { useAuth } from '@/lib/auth';
import { useEffect, useState } from 'react';
import { getWallet, depositWallet, withdrawWallet, Wallet as WalletType } from '@/lib/api';
import {
  Wallet as WalletIcon,
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
  Plus,
  ArrowRight,
  Coins,
  Shield,
  Activity,
  Signal
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
        <p className="text-muted-foreground font-medium animate-pulse">Syncing Financial Protocols...</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-10 pb-20 relative">
      {/* Decorative Elements */}
      <div className="absolute -top-40 -right-40 w-96 h-96 bg-primary/10 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="absolute top-1/2 -left-40 w-80 h-80 bg-blue-500/5 rounded-full blur-[100px] pointer-events-none"></div>

      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-10">
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-primary font-black text-[10px] uppercase tracking-[0.4em] mb-2 animate-pulse">
            <Signal size={14} />
            Finance Core Online
          </div>
          <h1 className="text-4xl md:text-6xl font-black text-white tracking-tighter uppercase italic">Financial <span className="text-primary not-italic">Hub</span></h1>
          <p className="text-muted-foreground max-w-lg font-medium leading-relaxed">Secure gateway for protocol credit management and automated network settlements.</p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[10px] font-black uppercase tracking-widest text-muted-foreground shadow-[var(--glass-shadow)] transition-all hover:border-primary/20">
            <ShieldCheck size={14} className="text-primary" />
            Active Protocol Bridge
          </div>
        </div>
      </div>

      {/* Main Balance Card */}
      <div className="relative group p-10 md:p-14 rounded-[3rem] bg-[var(--glass-bg)] border border-[var(--glass-border)] overflow-hidden shadow-[var(--glass-shadow)] transition-all duration-700 hover:border-primary/20">
        <div className="absolute top-0 right-0 p-12 transition-all duration-700 group-hover:scale-110 opacity-[0.03]">
          <Coins className="w-64 h-64 text-primary" />
        </div>

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-12">
          <div className="space-y-6 text-center lg:text-left">
            <div className="inline-flex items-center gap-3 px-4 py-2 rounded-xl bg-white/5 border border-white/10">
              <WalletIcon size={16} className="text-primary" />
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Protocol Balance</span>
            </div>

            <div className="space-y-2">
              <div className="text-7xl md:text-8xl font-black text-white tracking-tighter flex items-baseline justify-center lg:justify-start gap-4 italic">
                <span className="text-3xl md:text-4xl opacity-20 not-italic font-bold">{wallet?.currency || '₵'}</span>
                {wallet?.balance?.toFixed(2) || '0.00'}
              </div>
              <div className="flex items-center justify-center lg:justify-start gap-4">
                <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-50">
                  <Activity size={12} className="text-green-500" />
                  Synchronized
                </div>
                <div className="w-1 h-1 rounded-full bg-white/10"></div>
                <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-50">
                  {wallet?.currency || 'GHS'} Network
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 w-full lg:w-auto">
            <button
              onClick={() => { setAction('deposit'); setResult(null); }}
              className="flex-1 lg:flex-none group relative px-10 py-6 rounded-[2rem] bg-primary text-black font-black uppercase tracking-widest text-xs overflow-hidden transition-all hover:scale-[1.02] active:scale-95 shadow-[0_20px_40px_-10px_rgba(34,197,94,0.3)]"
            >
              <div className="relative z-10 flex items-center justify-center gap-3">
                <ArrowDownLeft size={20} className="transition-transform group-hover:-translate-x-1 group-hover:translate-y-1" />
                <span>Initialize Deposit</span>
              </div>
            </button>
            <button
              onClick={() => { setAction('withdraw'); setResult(null); }}
              className="flex-1 lg:flex-none group relative px-10 py-6 rounded-[2rem] bg-white/[0.05] border border-white/10 text-white font-black uppercase tracking-widest text-xs transition-all hover:bg-white/[0.08] hover:border-white/20 active:scale-95"
            >
              <div className="relative z-10 flex items-center justify-center gap-3">
                <ArrowUpRight size={20} className="transition-transform group-hover:translate-x-1 group-hover:-translate-y-1" />
                <span>Withdraw Credits</span>
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* Grid: Stats & History */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
        {/* Transaction History - Column Span 2 */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between px-4">
            <div className="flex items-center gap-3 text-white font-black uppercase tracking-[0.2em] text-xs">
              <History size={18} className="text-primary" />
              Ledger Synchronicity
            </div>
            <div className="h-[1px] flex-1 mx-6 bg-gradient-to-r from-white/10 to-transparent"></div>
            <span className="text-[10px] font-black text-muted-foreground opacity-30 uppercase tracking-widest">REAL-TIME LOG</span>
          </div>

          <div className="rounded-[2.5rem] bg-[var(--glass-bg)] border border-[var(--glass-border)] overflow-hidden shadow-[var(--glass-shadow)] transition-all hover:border-[var(--glass-border)]/20">
            {(!wallet?.transactions || wallet.transactions.length === 0) ? (
              <div className="p-20 text-center space-y-6">
                <div className="w-20 h-20 rounded-full bg-white/[0.03] border border-white/5 flex items-center justify-center mx-auto text-white/10 animate-pulse">
                  <History size={36} />
                </div>
                <div className="space-y-1">
                  <p className="text-white font-black uppercase tracking-widest text-sm italic">Ledger Empty</p>
                  <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest opacity-40">Await first protocol settlement</p>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-white/[0.02]">
                      <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-50">Operation</th>
                      <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-50">Quantum</th>
                      <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-50">Status</th>
                      <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-50">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {wallet.transactions.map((tx) => (
                      <tr key={tx.id} className="group hover:bg-white/[0.02] transition-all duration-300">
                        <td className="px-8 py-6">
                          <div className="flex flex-col gap-1">
                            <span className="text-sm font-black text-white uppercase tracking-tighter italic group-hover:text-primary transition-colors">{tx.description}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-40">{tx.type}</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-8 py-6">
                          <div className={`text-sm font-black italic tracking-tighter tabular-nums ${tx.amount >= 0 ? 'text-primary' : 'text-red-400'}`}>
                            {tx.amount >= 0 ? '+' : ''}{tx.amount.toFixed(2)}
                          </div>
                        </td>
                        <td className="px-8 py-6">
                          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/5 text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground">
                            <div className="w-1 h-1 rounded-full bg-primary animate-pulse"></div>
                            Settled
                          </div>
                        </td>
                        <td className="px-8 py-6">
                          <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground opacity-40">
                            <Clock size={12} />
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

        {/* Network Rates - Column Span 1 */}
        <div className="space-y-6">
          <div className="flex items-center gap-3 text-white font-black uppercase tracking-[0.2em] text-xs px-4">
            <Zap size={18} className="text-primary" />
            Exchange Rates
          </div>

          <div className="space-y-4">
            {[
              { label: 'Bandwidth Leak', price: '₵0.50', sub: 'per GB protocol data', icon: Zap, color: 'text-orange-400' },
              { label: 'Entry Threshold', price: '₵1.00', sub: 'Min Network Deposit', icon: ArrowDownLeft, color: 'text-primary' },
              { label: 'Exit Threshold', price: '₵5.00', sub: 'Min External Transfer', icon: ArrowUpRight, color: 'text-blue-400' },
            ].map((p, i) => (
              <div key={i} className="group relative p-8 rounded-[2.5rem] bg-[var(--glass-bg)] border border-[var(--glass-border)] transition-all duration-500 hover:border-primary/20 shadow-[var(--glass-shadow)] overflow-hidden">
                <div className="absolute top-0 right-0 p-6 opacity-[0.05] group-hover:scale-110 transition-transform">
                  <p.icon size={48} className={p.color} />
                </div>
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-4">
                    <div className={`p-3 rounded-2xl bg-white/5 ${p.color}`}>
                      <p.icon size={20} />
                    </div>
                  </div>
                  <div className="text-4xl font-black text-white tracking-tighter mb-1 italic">{p.price}</div>
                  <div className="text-[10px] font-black text-muted-foreground uppercase tracking-widest opacity-40 group-hover:opacity-60 transition-opacity">
                    {p.sub}
                  </div>
                </div>
              </div>
            ))}

            <div className="p-8 rounded-[2.5rem] bg-primary/5 border border-primary/10 flex items-start gap-5 group">
              <div className="p-2 rounded-lg bg-primary/10 text-primary group-hover:scale-110 transition-transform">
                <Shield size={18} />
              </div>
              <p className="text-[10px] font-bold text-white/50 leading-relaxed uppercase tracking-wider">
                Algorithms adjust rates based on <span className="text-primary italic">Global Demand</span> and infrastructure availability. All settlements are immutable.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Modal Overlay */}
      {action && (
        <div className="fixed inset-0 bg-[#000]/90 backdrop-blur-md flex items-center justify-center z-[100] p-6 animate-in fade-in duration-500">
          <div className="bg-[#050505] border border-white/10 rounded-[3.5rem] p-10 md:p-14 max-w-xl w-full relative overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-8 duration-500 shadow-2xl">
            {/* Modal Ambient Light */}
            <div className={`absolute top-[-20%] left-1/2 -translate-x-1/2 w-[80%] h-[40%] blur-[120px] opacity-20 ${action === 'deposit' ? 'bg-primary' : 'bg-blue-500'}`}></div>

            <button
              onClick={() => setAction(null)}
              className="absolute top-10 right-10 p-3 rounded-2xl bg-white/5 border border-white/10 text-muted-foreground hover:text-white transition-all hover:rotate-90 z-[110]"
            >
              <X size={24} />
            </button>

            <div className="relative z-10 space-y-10">
              <div className="flex items-center gap-6">
                <div className={`p-5 rounded-3xl ${action === 'deposit' ? 'bg-primary/20 text-primary shadow-[0_0_30px_rgba(34,197,94,0.2)]' : 'bg-blue-500/20 text-blue-500 shadow-[0_0_30px_rgba(59,130,246,0.2)]'}`}>
                  {action === 'deposit' ? <CreditCard size={32} /> : <Smartphone size={32} />}
                </div>
                <div className="space-y-1">
                  <h3 className="text-3xl font-black text-white tracking-tighter uppercase italic">
                    {action === 'deposit' ? 'Initialize <span className="text-primary not-italic">Deposit</span>' : 'Authorize <span className="text-blue-500 not-italic">Withdrawal</span>'}
                  </h3>
                  <div className="flex items-center gap-2">
                    <Signal size={12} className="text-primary opacity-50" />
                    <p className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.3em] opacity-50">
                      {action === 'deposit' ? 'Securing outbound tunnel' : 'Routing to destination terminal'}
                    </p>
                  </div>
                </div>
              </div>

              {result && (
                <div className={`p-6 rounded-3xl flex items-center gap-5 animate-in slide-in-from-top-4 duration-500 ${result.success ? 'bg-primary/10 border border-primary/20 text-primary' : 'bg-red-500/10 border border-red-500/20 text-red-400'}`}>
                  <div className="p-2 rounded-full bg-white/5">
                    {result.success ? <ShieldCheck size={20} /> : <Info size={20} />}
                  </div>
                  <p className="text-xs font-black uppercase tracking-widest leading-relaxed">{result.message}</p>
                </div>
              )}

              <form onSubmit={action === 'deposit' ? handleDeposit : handleWithdraw} className="space-y-10">
                <div className="space-y-4">
                  <label className="block text-[10px] font-black uppercase tracking-[0.4em] text-white/30 ml-2">Protocol Quantity (₵)</label>
                  <div className="relative group/input">
                    <div className="absolute left-7 top-1/2 -translate-y-1/2 text-white/10 font-black text-2xl group-focus-within/input:text-primary transition-all duration-500">₵</div>
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder={action === 'deposit' ? '1.00 +' : '5.00 +'}
                      min={action === 'deposit' ? 1 : 5}
                      step="0.01"
                      required
                      className="w-full bg-white/[0.02] border border-white/5 rounded-[2rem] py-8 pl-14 pr-8 text-3xl font-black text-white outline-none focus:border-primary/50 focus:bg-white/[0.04] transition-all duration-500 placeholder:text-white/5"
                    />
                  </div>
                </div>

                {action === 'withdraw' && (
                  <div className="space-y-4 animate-in fade-in slide-in-from-top-4 duration-500">
                    <label className="block text-[10px] font-black uppercase tracking-[0.4em] text-white/30 ml-2">MoMo Terminal Address</label>
                    <div className="relative group/input">
                      <Smartphone className="absolute left-7 top-1/2 -translate-y-1/2 text-white/10 group-focus-within/input:text-blue-500 transition-all duration-500" size={24} />
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="Terminal ID (05XXXXXXX)"
                        required
                        className="w-full bg-white/[0.02] border border-white/5 rounded-[2rem] py-8 pl-16 pr-8 text-2xl font-black text-white outline-none focus:border-blue-500/50 focus:bg-white/[0.04] transition-all duration-500 placeholder:text-white/5"
                      />
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={processing}
                  className={`w-full group relative py-8 rounded-[2rem] font-black uppercase tracking-[0.3em] text-xs transition-all duration-500 flex items-center justify-center gap-4 disabled:opacity-50 ${action === 'deposit'
                    ? 'bg-primary text-black hover:shadow-[0_0_60px_rgba(34,197,94,0.4)] hover:scale-[1.01]'
                    : 'bg-blue-600 text-white hover:bg-blue-500 hover:shadow-[0_0_60px_rgba(59,130,246,0.4)] hover:scale-[1.01]'
                    }`}
                >
                  {processing ? (
                    <div className="flex items-center gap-4">
                      <div className="w-6 h-6 border-4 border-current border-t-transparent rounded-full animate-spin"></div>
                      <span>Synching Protocol...</span>
                    </div>
                  ) : (
                    <>
                      <span>{action === 'deposit' ? 'Authorize Payment' : 'Confirm Payout'}</span>
                      <ArrowRight size={20} className="transition-transform group-hover:translate-x-2" />
                    </>
                  )}
                </button>
              </form>

              <p className="text-center text-[9px] font-black uppercase tracking-[0.2em] text-white/20">
                End-to-end encrypted financial tunnel active. Settlement is non-reversible.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
