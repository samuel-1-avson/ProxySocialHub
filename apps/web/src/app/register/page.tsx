'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { WalletBoundary } from '@/providers/WalletBoundary';
import { ROUTES } from '@/lib/navigation/routes';
import { captureReferralCodeFromSearch, peekReferralCode } from '@/lib/referral';

const WalletAuthPanel = dynamic(
  () => import('@/components/WalletAuthPanel').then((mod) => mod.WalletAuthPanel),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-[160px] items-center justify-center rounded-[var(--radius-md)] border border-border bg-card text-sm text-muted-foreground">
        Initializing wallet access…
      </div>
    ),
  }
);

export default function RegisterPage() {
  const [referralCode, setReferralCode] = useState<string | null>(null);

  useEffect(() => {
    setReferralCode(captureReferralCodeFromSearch() || peekReferralCode());
  }, []);

  return (
    <WalletBoundary>
      <div className="min-h-screen bg-background text-foreground">
        <header className="border-b border-border">
          <div className="mx-auto flex h-14 max-w-[1120px] items-center justify-between px-4 sm:px-6">
            <Link href={ROUTES.home} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" />
              Back to home
            </Link>
            <span className="font-data text-sm font-semibold tracking-[0.12em] uppercase">ProxyHub</span>
          </div>
        </header>

        <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-md flex-col justify-center px-4 py-16 sm:px-6">
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Create your account</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Connect a Solana wallet. No passwords, no email gate.
            </p>
            {referralCode ? (
              <p className="mt-3 text-xs font-mono text-emerald-400/90 uppercase tracking-widest">
                Invite code {referralCode} will apply on first signup
              </p>
            ) : null}
          </div>

          <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6 sm:p-8">
            <ol className="mb-6 space-y-3">
              {[
                'Connect your Solana wallet',
                'Sign the verification message',
                'Your account is created instantly',
              ].map((step, i) => (
                <li key={step} className="flex items-center gap-3 text-sm text-muted-foreground">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-secondary font-data text-xs font-medium text-foreground">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>

            <WalletAuthPanel mode="register" actionLabel="Create account with wallet" />
          </div>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link href={ROUTES.login} className="font-medium text-primary hover:underline">
              Sign in
            </Link>
          </p>

          <p className="mt-8 text-center text-xs text-muted-foreground">
            By connecting your wallet, you agree to the{' '}
            <Link href={ROUTES.terms} className="text-primary hover:underline">Terms of Service</Link>
            {' '}and{' '}
            <Link href={ROUTES.privacy} className="text-primary hover:underline">Privacy Policy</Link>.
          </p>
        </main>
      </div>
    </WalletBoundary>
  );
}
