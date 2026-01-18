'use client';

import { useAuth } from '@/lib/auth';
import { useEffect, useState } from 'react';
import { getWallet, depositWallet, withdrawWallet, Wallet } from '@/lib/api';

export default function WalletPage() {
  const { user } = useAuth();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<'deposit' | 'withdraw' | null>(null);
  const [amount, setAmount] = useState('');
  const [phone, setPhone] = useState(''); // Keep for withdrawals
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
      setResult({ success: false, message: 'User email not found. Please log in again.' });
      return;
    }

    setProcessing(true);
    setResult(null);
    try {
      const res = await depositWallet(parseFloat(amount), user.email);
      setResult({ success: true, message: 'Redirecting to payment gateway...' });

      // Redirect to Paystack
      if (res.authorization_url) {
        window.location.href = res.authorization_url;
      } else {
        setResult({ success: false, message: 'Failed to get payment URL.' });
      }
    } catch (error: any) {
      console.error('Deposit error:', error);
      setResult({ success: false, message: 'Deposit failed. Please try again.' });
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
      setResult({ success: true, message: `Withdrawal initiated. New balance: GHS ${res.new_balance.toFixed(2)}` });
      setAmount('');
      setPhone('');
      setTimeout(() => {
        fetchWallet();
        setAction(null);
      }, 3000);
    } catch {
      setResult({ success: false, message: 'Withdrawal failed. Please try again.' });
    } finally {
      setProcessing(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-orange-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white">Wallet</h1>
        <p className="text-gray-400 mt-1">Manage your funds</p>
      </div>

      {/* Balance Card */}
      <div className="bg-gradient-to-br from-orange-500/20 to-amber-500/20 backdrop-blur-sm rounded-2xl p-8 border border-orange-500/30">
        <p className="text-gray-300">Current Balance</p>
        <p className="text-5xl font-bold text-white mt-2">
          {wallet?.currency || 'GHS'} {wallet?.balance?.toFixed(2) || '0.00'}
        </p>
        <div className="mt-6 flex space-x-4">
          <button
            onClick={() => { setAction('deposit'); setResult(null); }}
            className="px-6 py-3 bg-green-500 hover:bg-green-600 text-white rounded-xl font-medium transition"
          >
            💳 Deposit
          </button>
          <button
            onClick={() => { setAction('withdraw'); setResult(null); }}
            className="px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-xl font-medium transition"
          >
            💸 Withdraw
          </button>
        </div>
      </div>

      {/* Deposit/Withdraw Modal */}
      {action && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-2xl p-8 max-w-md w-full mx-4 border border-gray-700">
            <h3 className="text-xl font-semibold text-white mb-4">
              {action === 'deposit' ? '💳 Deposit Funds' : '💸 Withdraw Funds'}
            </h3>

            {result && (
              <div className={`mb-4 p-4 rounded-lg ${result.success ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                {result.message}
              </div>
            )}

            <form onSubmit={action === 'deposit' ? handleDeposit : handleWithdraw}>
              <div className="space-y-4">
                <div>
                  <label className="block text-gray-400 text-sm mb-2">Amount (GHS)</label>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder={action === 'deposit' ? 'Min: 1 GHS' : 'Min: 5 GHS'}
                    min={action === 'deposit' ? 1 : 5}
                    step="0.01"
                    required
                    className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-orange-500"
                  />
                </div>
                {action === 'withdraw' && (
                  <div>
                    <label className="block text-gray-400 text-sm mb-2">MoMo Phone Number</label>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="e.g., 0241234567"
                      required
                      className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-orange-500"
                    />
                    <p className="text-gray-500 text-xs mt-1">Funds will be sent to this number via MoMo</p>
                  </div>
                )}
              </div>

              <div className="mt-6 flex space-x-3">
                <button
                  type="button"
                  onClick={() => setAction(null)}
                  className="flex-1 px-4 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={processing}
                  className={`flex-1 px-4 py-3 text-white rounded-lg transition disabled:opacity-50 ${action === 'deposit' ? 'bg-green-500 hover:bg-green-600' : 'bg-blue-500 hover:bg-blue-600'
                    }`}
                >
                  {processing ? 'Processing...' : action === 'deposit' ? 'Proceed to Payment 💳' : 'Confirm Withdrawal 💸'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Transaction History */}
      <div className="bg-gray-800/50 backdrop-blur-sm rounded-2xl p-6 border border-gray-700/50">
        <h2 className="text-xl font-semibold text-white mb-4">Transaction History</h2>
        {(!wallet?.transactions || wallet.transactions.length === 0) ? (
          <p className="text-gray-400">No transactions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-gray-400 text-sm border-b border-gray-700">
                  <th className="pb-3">Type</th>
                  <th className="pb-3">Amount</th>
                  <th className="pb-3">Description</th>
                  <th className="pb-3">Date</th>
                </tr>
              </thead>
              <tbody>
                {wallet.transactions.map((tx) => (
                  <tr key={tx.id} className="border-b border-gray-700/50">
                    <td className="py-3">
                      <span className={`px-2 py-1 rounded-full text-xs capitalize ${tx.type === 'topup' ? 'bg-green-500/20 text-green-400' :
                        tx.type === 'usage' ? 'bg-orange-500/20 text-orange-400' :
                          tx.type === 'payout' ? 'bg-blue-500/20 text-blue-400' :
                            'bg-gray-500/20 text-gray-400'
                        }`}>
                        {tx.type}
                      </span>
                    </td>
                    <td className={`py-3 font-mono ${tx.amount >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {tx.amount >= 0 ? '+' : ''}{tx.amount.toFixed(2)} GHS
                    </td>
                    <td className="py-3 text-gray-300">{tx.description}</td>
                    <td className="py-3 text-gray-400">
                      {new Date(tx.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pricing Info */}
      <div className="bg-gray-800/50 backdrop-blur-sm rounded-2xl p-6 border border-gray-700/50">
        <h2 className="text-xl font-semibold text-white mb-4">💡 Pricing</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 bg-gray-900/50 rounded-lg">
            <p className="text-2xl font-bold text-orange-400">GHS 0.50</p>
            <p className="text-gray-400 mt-1">per GB of bandwidth</p>
          </div>
          <div className="p-4 bg-gray-900/50 rounded-lg">
            <p className="text-2xl font-bold text-green-400">GHS 1</p>
            <p className="text-gray-400 mt-1">minimum deposit</p>
          </div>
          <div className="p-4 bg-gray-900/50 rounded-lg">
            <p className="text-2xl font-bold text-blue-400">GHS 5</p>
            <p className="text-gray-400 mt-1">minimum withdrawal</p>
          </div>
        </div>
      </div>
    </div>
  );
}
