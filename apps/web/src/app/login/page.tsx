'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { WalletBoundary } from '@/providers/WalletBoundary';
import { ROUTES } from '@/lib/navigation/routes';

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

export default function LoginPage() {
  return (
    <WalletBoundary>
      <div className="min-h-screen bg-background text-foreground">
        {/* Marketing chrome */}
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
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Sign in</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Connect your Solana wallet to access the marketplace.
            </p>
          </div>

          <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6 sm:p-8">
            <WalletAuthPanel
              mode="login"
              actionLabel="Sign in with wallet"
              idleMessage="Connect your Solana wallet to continue"
            />
          </div>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            New to ProxyHub?{' '}
            <Link href={ROUTES.register} className="font-medium text-primary hover:underline">
              Create an account
            </Link>
          </p>
        </main>
      </div>
    </WalletBoundary>
  );
}
