'use client';

import React, { useState } from 'react';
import {
  Server,
  Coins,
  ShieldCheck,
  Radio,
  Zap,
  Activity,
  ArrowUpRight,
  Lock,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';

export function DePINPortal() {
  const [activeTab, setActiveTab] = useState<'gateways' | 'mining' | 'receipts' | 'direct_p2p'>('gateways');
  const [isStaking, setIsStaking] = useState(false);
  const [stakeAmount, setStakeAmount] = useState('1.5');
  const [claimed, setClaimed] = useState(false);

  // Mock initial data reflecting our Solana program state & DePIN infrastructure
  const [gatewayStats] = useState({
    totalBondedSol: 142.5,
    activeOperators: 28,
    averageLatencyMs: 24,
    slashedStakeTotal: 1.2,
  });

  const [miningPool] = useState({
    epochId: 42,
    epochEmissionSol: 50.0,
    totalVerifiedGb: 18450,
    userVerifiedGb: 320.5,
    estimatedUserRewardSol: 0.868,
    epochEndsIn: '14h 22m',
  });

  const [receipts] = useState([
    {
      escrow: '8LZji5mK3B7YfG9M2W7o7v2gV3yqK7v4jK2L5mN8P9Q',
      buyer: '3FTBuRDD9LcfHbQDLRPniLHfbW58uLSb1WbWpc1cbQ5m',
      provider: 'DNajRCExDb8cRNjywTmGuFkzyjLGkfBCofY2uVrjkEXe',
      bytes: '2.5 GB',
      seq: 5,
      payoutSol: 0.025,
      status: 'Settled On-Chain',
      timestamp: '2 mins ago',
    },
    {
      escrow: '4yVb42...9Kj',
      buyer: '7Kq8...11a',
      provider: '9Jp2...44z',
      bytes: '10.2 GB',
      seq: 18,
      payoutSol: 0.102,
      status: 'Settled On-Chain',
      timestamp: '8 mins ago',
    },
    {
      escrow: '9Nm1...33x',
      buyer: '2Lm9...88q',
      provider: '5Tv7...12w',
      bytes: '1.1 GB',
      seq: 2,
      payoutSol: 0.011,
      status: 'Settled On-Chain',
      timestamp: '15 mins ago',
    },
  ]);

  const handleClaim = () => {
    setClaimed(true);
    setTimeout(() => setClaimed(false), 4000);
  };

  return (
    <div className="min-h-screen bg-black text-white px-4 sm:px-6 lg:px-8 py-10">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="border-b border-white/10 pb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold uppercase tracking-wider mb-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Solana DePIN Protocol v2.0
            </div>
            <h1 className="text-3xl font-black tracking-tight sm:text-4xl text-white">
              DePIN Operator & Mining Portal
            </h1>
            <p className="text-sm text-neutral-400 mt-1">
              Permissionless Staked Gateways, Zero-Knowledge Rollups, and Proof-of-Bandwidth Mining.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="bg-neutral-900 border border-white/10 rounded-xl px-4 py-2 text-right">
              <div className="text-[10px] text-neutral-400 font-medium uppercase tracking-wider">
                DePIN Maturity Index
              </div>
              <div className="text-xl font-extrabold text-emerald-400">88% (Advanced)</div>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 border-b border-white/10 overflow-x-auto pb-2">
          {[
            { id: 'gateways', label: 'Staked Gateways', icon: Server },
            { id: 'mining', label: 'Proof-of-Bandwidth Mining', icon: Coins },
            { id: 'receipts', label: 'Mutual Receipts Explorer', icon: ShieldCheck },
            { id: 'direct_p2p', label: 'Direct P2P Mesh', icon: Radio },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all whitespace-nowrap ${
                  active
                    ? 'bg-white text-black shadow-lg shadow-white/5'
                    : 'text-neutral-400 hover:text-white hover:bg-neutral-900'
                }`}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab 1: Staked Gateways */}
        {activeTab === 'gateways' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-neutral-950 border border-white/10 rounded-2xl p-5">
                <div className="text-xs text-neutral-400 font-medium">Total Bonded Stake</div>
                <div className="text-2xl font-black text-white mt-1">{gatewayStats.totalBondedSol} SOL</div>
                <div className="text-[11px] text-emerald-400 mt-2 flex items-center gap-1">
                  <ArrowUpRight size={13} /> Non-custodial PDA Escrows
                </div>
              </div>
              <div className="bg-neutral-950 border border-white/10 rounded-2xl p-5">
                <div className="text-xs text-neutral-400 font-medium">Active Operators</div>
                <div className="text-2xl font-black text-white mt-1">{gatewayStats.activeOperators} Gateways</div>
                <div className="text-[11px] text-neutral-400 mt-2">Enforced fail-closed bond</div>
              </div>
              <div className="bg-neutral-950 border border-white/10 rounded-2xl p-5">
                <div className="text-xs text-neutral-400 font-medium">Network Avg Latency</div>
                <div className="text-2xl font-black text-white mt-1">{gatewayStats.averageLatencyMs} ms</div>
                <div className="text-[11px] text-emerald-400 mt-2">Optimal Yamux/QUIC streams</div>
              </div>
              <div className="bg-neutral-950 border border-white/10 rounded-2xl p-5">
                <div className="text-xs text-neutral-400 font-medium">Slashing Invariant</div>
                <div className="text-2xl font-black text-white mt-1">{gatewayStats.slashedStakeTotal} SOL Slashed</div>
                <div className="text-[11px] text-neutral-400 mt-2">Auto-deactivates if &lt;1.0 SOL</div>
              </div>
            </div>

            {/* Operator Stake Card */}
            <div className="bg-neutral-950 border border-white/10 rounded-2xl p-6 sm:p-8">
              <div className="max-w-2xl space-y-4">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <Lock size={20} className="text-amber-400" />
                  Become a Permissionless Gateway Operator
                </h2>
                <p className="text-sm text-neutral-400">
                  Bond at least 1.0 SOL to join the high-throughput edge routing layer. Earn routing fees from proxy sessions and relay micro-receipts directly on Solana.
                </p>

                <div className="pt-2 flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1">
                    <input
                      type="number"
                      step="0.1"
                      min="1.0"
                      value={stakeAmount}
                      onChange={(e) => setStakeAmount(e.target.value)}
                      className="w-full bg-neutral-900 border border-white/15 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-white transition-colors"
                      placeholder="Stake Amount (SOL)"
                    />
                    <span className="absolute right-4 top-3.5 text-xs text-neutral-400 font-semibold">SOL</span>
                  </div>
                  <button
                    onClick={() => {
                      setIsStaking(true);
                      setTimeout(() => setIsStaking(false), 2000);
                    }}
                    disabled={isStaking}
                    className="px-6 py-3 bg-white text-black font-bold text-sm rounded-xl hover:bg-neutral-200 transition-colors flex items-center justify-center gap-2"
                  >
                    {isStaking ? (
                      <>
                        <RefreshCw className="animate-spin" size={16} />
                        Confirming on Solana...
                      </>
                    ) : (
                      'Bond Stake to Gateway PDA'
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Proof-of-Bandwidth Mining */}
        {activeTab === 'mining' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-gradient-to-b from-neutral-900 to-neutral-950 border border-white/10 rounded-2xl p-6 space-y-4">
                <div className="flex items-center justify-between text-xs text-neutral-400">
                  <span>Current Mining Epoch</span>
                  <span className="text-emerald-400 font-semibold flex items-center gap-1">
                    <Activity size={12} /> Active
                  </span>
                </div>
                <div className="text-3xl font-black text-white">Epoch #{miningPool.epochId}</div>
                <div className="text-xs text-neutral-400">
                  Time Remaining: <span className="text-white font-bold">{miningPool.epochEndsIn}</span>
                </div>
                <div className="pt-2 border-t border-white/10 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-neutral-400">Epoch Pool Emission:</span>
                    <span className="font-bold text-white">{miningPool.epochEmissionSol} SOL</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-400">Total Verified Bandwidth:</span>
                    <span className="font-bold text-white">{(miningPool.totalVerifiedGb / 1024).toFixed(2)} TB</span>
                  </div>
                </div>
              </div>

              <div className="bg-neutral-950 border border-white/10 rounded-2xl p-6 space-y-4 md:col-span-2 flex flex-col justify-between">
                <div>
                  <div className="text-xs text-neutral-400 font-medium">Your Mining Performance</div>
                  <div className="text-2xl font-black text-white mt-1">
                    {miningPool.userVerifiedGb} GB Verified
                  </div>
                  <p className="text-xs text-neutral-400 mt-2">
                    Verified strictly via mutual cryptographic session receipts and Groth16 ZK batch headers.
                  </p>
                </div>

                <div className="pt-4 border-t border-white/10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <div className="text-[11px] text-neutral-400 uppercase tracking-wider">Estimated Epoch Reward</div>
                    <div className="text-2xl font-black text-emerald-400">
                      {miningPool.estimatedUserRewardSol} SOL
                    </div>
                  </div>

                  <button
                    onClick={handleClaim}
                    disabled={claimed}
                    className={`px-6 py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${
                      claimed
                        ? 'bg-emerald-500 text-black'
                        : 'bg-emerald-400 text-black hover:bg-emerald-300'
                    }`}
                  >
                    {claimed ? (
                      <>
                        <CheckCircle2 size={16} />
                        Reward Claimed!
                      </>
                    ) : (
                      <>
                        <Zap size={16} />
                        Claim Mining Reward
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Mutual Receipts Explorer */}
        {activeTab === 'receipts' && (
          <div className="bg-neutral-950 border border-white/10 rounded-2xl overflow-hidden">
            <div className="p-6 border-b border-white/10">
              <h2 className="text-lg font-bold text-white">State-Channel Mutual Receipts (Live Stream)</h2>
              <p className="text-xs text-neutral-400 mt-1">
                Zero-oracle cryptographic settlement between Buyer and Provider on Solana.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-neutral-900/60 text-neutral-400 uppercase tracking-wider font-semibold border-b border-white/5">
                  <tr>
                    <th className="p-4">Escrow PDA</th>
                    <th className="p-4">Buyer Pubkey</th>
                    <th className="p-4">Provider Hotkey</th>
                    <th className="p-4">Bandwidth</th>
                    <th className="p-4">Payout</th>
                    <th className="p-4">Status</th>
                    <th className="p-4 text-right">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {receipts.map((r, i) => (
                    <tr key={i} className="hover:bg-neutral-900/40 transition-colors">
                      <td className="p-4 font-mono text-neutral-300">{r.escrow.substring(0, 10)}...</td>
                      <td className="p-4 font-mono text-neutral-400">{r.buyer.substring(0, 10)}...</td>
                      <td className="p-4 font-mono text-neutral-400">{r.provider.substring(0, 10)}...</td>
                      <td className="p-4 font-bold text-white">{r.bytes}</td>
                      <td className="p-4 font-bold text-emerald-400">{r.payoutSol} SOL</td>
                      <td className="p-4">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-medium border border-emerald-500/20">
                          <CheckCircle2 size={11} /> {r.status}
                        </span>
                      </td>
                      <td className="p-4 text-right text-neutral-500">{r.timestamp}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 4: Direct P2P Mesh */}
        {activeTab === 'direct_p2p' && (
          <div className="bg-neutral-950 border border-white/10 rounded-2xl p-6 sm:p-8 space-y-6">
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <Radio size={20} className="text-emerald-400" />
                Zero-Gateway Direct P2P Tunnels
              </h2>
              <p className="text-sm text-neutral-400">
                End-to-end encrypted WebRTC DataChannels and QUIC/UDP streams connect buyers directly to residential nodes, bypassing edge gateways for zero-intermediary traffic.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <div className="bg-neutral-900 border border-white/10 rounded-xl p-5 space-y-3">
                <div className="text-xs font-semibold text-neutral-300">Direct WebRTC / QUIC Stream</div>
                <div className="text-2xl font-black text-emerald-400">14 ms Latency</div>
                <p className="text-xs text-neutral-400">
                  Zero hops. Traffic flows point-to-point via STUN/ICE NAT traversal.
                </p>
              </div>

              <div className="bg-neutral-900 border border-white/10 rounded-xl p-5 space-y-3">
                <div className="text-xs font-semibold text-neutral-300">Staked Gateway Fallback</div>
                <div className="text-2xl font-black text-neutral-300">28 ms Latency</div>
                <p className="text-xs text-neutral-400">
                  Relayed via bonded edge gateways if strict symmetrical NAT is encountered.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
