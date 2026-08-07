"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import { NetworkPulse } from "@/components/marketing/NetworkPulse";
import {
  FOOTER_LEGAL_LINKS,
  FOOTER_PLATFORM_LINKS,
  FOOTER_SUPPORT_LINKS,
  ROUTES,
} from "@/lib/navigation/routes";

/**
 * Public landing — Quiet Infrastructure.
 * Interactive, minimal, auth-aware.
 */
export default function Home() {
  const { user, isLoading } = useAuth();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingHeader />

      <main>
        {/* Hero — full viewport, interactive network mesh */}
        <section className="relative isolate flex min-h-[calc(100vh-3.5rem)] flex-col overflow-hidden border-b border-border">
          <NetworkPulse />

          <div className="relative z-10 mx-auto flex w-full max-w-[1120px] flex-1 flex-col justify-center px-4 py-20 sm:px-6">
            <p className="mb-6 font-data text-xs font-medium uppercase tracking-[0.2em] text-primary">
              ProxyHub
            </p>

            <h1 className="max-w-3xl text-5xl font-semibold tracking-tight text-foreground sm:text-6xl md:text-7xl md:leading-[1.05]">
              The decentralized bandwidth marketplace.
            </h1>

            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground sm:text-xl">
              Buy verified residential proxy capacity or earn by running nodes anywhere. Usage is metered at the edge and settled on-chain.
            </p>

            <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
              {isLoading ? (
                <span className="h-12 w-40 animate-pulse rounded-[var(--radius-md)] bg-secondary" aria-hidden />
              ) : user ? (
                <Link
                  href={ROUTES.dashboard}
                  className="inline-flex h-12 items-center justify-center rounded-[var(--radius-md)] bg-primary px-8 text-base font-medium text-primary-foreground transition-colors hover:bg-[var(--primary-dark)]"
                >
                  Open dashboard
                </Link>
              ) : (
                <>
                  <Link
                    href={ROUTES.register}
                    className="inline-flex h-12 items-center justify-center rounded-[var(--radius-md)] bg-primary px-8 text-base font-medium text-primary-foreground transition-colors hover:bg-[var(--primary-dark)]"
                  >
                    Get started
                  </Link>
                  <Link
                    href={ROUTES.explorer}
                    className="inline-flex h-12 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-transparent px-8 text-base font-medium text-foreground transition-colors hover:bg-secondary"
                  >
                    Explore the network
                  </Link>
                </>
              )}
            </div>

            {/* Scroll hint */}
            <div className="mt-16 flex items-center gap-3 text-sm text-muted-foreground">
              <span className="h-px w-8 bg-border-strong" />
              <span>Scroll to see how it works</span>
            </div>
          </div>
        </section>

        {/* Proof strip */}
        <section className="border-b border-border" aria-label="Network proof points">
          <div className="mx-auto grid max-w-[1120px] grid-cols-1 divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {[
              { value: "Devnet", label: "Settlement network" },
              { value: "CONNECT", label: "Buyer proxy protocol" },
              { value: "SOL", label: "Settlement rail" },
            ].map((m) => (
              <div key={m.label} className="px-6 py-10 sm:px-8">
                <div className="font-data text-3xl font-semibold tabular-nums text-foreground">
                  {m.value}
                </div>
                <div className="mt-2 text-sm text-muted-foreground">{m.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section className="border-b border-border py-24 sm:py-32">
          <div className="mx-auto max-w-[1120px] px-4 sm:px-6">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">How it works</h2>
            <p className="mt-3 max-w-xl text-lg text-muted-foreground">
              Three steps from wallet to live session — no vendor lock-in, no opaque billing.
            </p>
            <ol className="mt-16 grid gap-12 sm:grid-cols-3">
              {[
                {
                  step: "01",
                  title: "Connect a wallet",
                  desc: "Sign in with Solana. No passwords, no email gate.",
                },
                {
                  step: "02",
                  title: "Buy or sell capacity",
                  desc: "Browse listings as a buyer, or register nodes and publish supply.",
                },
                {
                  step: "03",
                  title: "Route and settle",
                  desc: "Traffic hits the edge gateway; usage settles against your wallet balance.",
                },
              ].map((item) => (
                <li key={item.step} className="group min-w-0">
                  <div className="font-data text-sm text-primary transition-transform group-hover:-translate-y-0.5">
                    {item.step}
                  </div>
                  <h3 className="mt-4 text-xl font-semibold tracking-tight">{item.title}</h3>
                  <p className="mt-3 text-base leading-relaxed text-muted-foreground">{item.desc}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Buyer / provider split */}
        <section className="border-b border-border py-24 sm:py-32">
          <div className="mx-auto grid max-w-[1120px] gap-8 px-4 sm:px-6 md:grid-cols-2">
            <div className="group border border-border bg-card p-10 transition-colors hover:border-[var(--border-strong)] sm:p-12">
              <h2 className="text-2xl font-semibold tracking-tight">For buyers</h2>
              <p className="mt-4 text-base leading-relaxed text-muted-foreground">
                Residential routes with transparent pricing, session credentials, and usage you can audit.
              </p>
              <Link
                href={ROUTES.marketplace}
                className="mt-8 inline-flex items-center gap-2 text-base font-medium text-primary transition-colors hover:gap-3"
              >
                Browse marketplace
                <span aria-hidden>→</span>
              </Link>
            </div>
            <div className="group border border-border bg-card p-10 transition-colors hover:border-[var(--border-strong)] sm:p-12">
              <h2 className="text-2xl font-semibold tracking-tight">For providers</h2>
              <p className="mt-4 text-base leading-relaxed text-muted-foreground">
                Run the provider node CLI, publish listings, and earn when buyers route through your capacity.
              </p>
              <Link
                href={ROUTES.dashboardBecomeProvider}
                className="mt-8 inline-flex items-center gap-2 text-base font-medium text-primary transition-colors hover:gap-3"
              >
                Become a provider
                <span aria-hidden>→</span>
              </Link>
            </div>
          </div>
        </section>

        {/* Network teaser */}
        <section className="border-b border-border py-24 sm:py-32">
          <div className="mx-auto max-w-[1120px] px-4 sm:px-6">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Live network</h2>
            <p className="mt-3 max-w-xl text-lg text-muted-foreground">
              Inspect nodes, sessions, and settlement activity on the public explorer — no account required.
            </p>
            <div className="mt-10 flex flex-wrap gap-4">
              <Link
                href={ROUTES.explorer}
                className="inline-flex h-12 items-center rounded-[var(--radius-md)] border border-[var(--border-strong)] px-6 text-base font-medium transition-colors hover:bg-secondary"
              >
                Open explorer
              </Link>
              <Link
                href={ROUTES.explorerHealth}
                className="inline-flex h-12 items-center rounded-[var(--radius-md)] px-6 text-base font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Network health
              </Link>
            </div>
          </div>
        </section>

        <footer className="py-20">
          <div className="mx-auto max-w-[1120px] px-4 sm:px-6">
            <div className="grid grid-cols-2 gap-12 md:grid-cols-4">
              <div className="col-span-2 md:col-span-1">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] bg-primary text-primary-foreground font-data text-sm font-bold">
                    PH
                  </span>
                  <span className="font-data text-sm font-semibold tracking-[0.12em] uppercase">
                    ProxyHub
                  </span>
                </div>
                <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
                  Quiet infrastructure for residential proxy bandwidth.
                </p>
              </div>
              <div>
                <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Platform
                </h3>
                <ul className="mt-5 space-y-3 text-sm">
                  {FOOTER_PLATFORM_LINKS.map((item) => (
                    <li key={item.href}>
                      <Link href={item.href} className="text-foreground/80 transition-colors hover:text-primary">
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Support
                </h3>
                <ul className="mt-5 space-y-3 text-sm">
                  {FOOTER_SUPPORT_LINKS.map((item) => (
                    <li key={item.href}>
                      <Link href={item.href} className="text-foreground/80 transition-colors hover:text-primary">
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Legal
                </h3>
                <ul className="mt-5 space-y-3 text-sm">
                  {FOOTER_LEGAL_LINKS.map((item) => (
                    <li key={item.href}>
                      <Link href={item.href} className="text-foreground/80 transition-colors hover:text-primary">
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="mt-16 border-t border-border pt-8 font-data text-xs text-muted-foreground">
              © {new Date().getFullYear()} ProxyHub. All rights reserved.
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
