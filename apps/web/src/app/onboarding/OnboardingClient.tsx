"use client";

/**
 * Buyer onboarding wizard shell — reconstruction plan §15.3.
 * Steps are resumable via ?step=; full marketplace connect is linked from the final step.
 */
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronRight, Wallet } from "lucide-react";
import { ROUTES } from "@/lib/navigation/routes";
import { AppShell } from "@/components/AppShell";
import { withAuth } from "@/components/ProtectedRoute";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

const STEPS = [
  { id: "welcome", title: "Welcome", description: "Choose your path" },
  { id: "wallet", title: "Wallet", description: "Confirm your linked wallet" },
  { id: "first-proxy", title: "First proxy", description: "Browse or connect" },
] as const;

function OnboardingPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const initial = (() => {
    const id = searchParams.get("step");
    const idx = STEPS.findIndex((s) => s.id === id);
    return idx >= 0 ? idx : 0;
  })();
  const [index, setIndex] = useState(initial);
  const step = STEPS[index];

  const goTo = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(STEPS.length - 1, next));
      setIndex(clamped);
      const id = STEPS[clamped].id;
      router.replace(`/onboarding?step=${id}`, { scroll: false });
    },
    [router]
  );

  const walletLabel = useMemo(() => {
    const addr = user?.wallet_address;
    if (!addr) return null;
    return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
  }, [user?.wallet_address]);

  return (
    <AppShell showBreadcrumbs={false} maxWidthClassName="max-w-xl">
      <div className="mx-auto space-y-8 py-8">
        <nav aria-label="Onboarding progress">
          <ol className="flex flex-wrap items-center gap-2">
            {STEPS.map((s, i) => {
              const done = i < index;
              const current = i === index;
              return (
                <li key={s.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => goTo(i)}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                      current && "border-primary bg-primary/10 text-primary",
                      done && "border-border bg-secondary text-foreground",
                      !current && !done && "border-border text-muted-foreground"
                    )}
                    aria-current={current ? "step" : undefined}
                  >
                    <span
                      className={cn(
                        "flex h-5 w-5 items-center justify-center rounded-full text-[10px]",
                        current || done
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-muted-foreground"
                      )}
                      aria-hidden
                    >
                      {done ? <Check size={12} /> : i + 1}
                    </span>
                    {s.title}
                  </button>
                  {i < STEPS.length - 1 ? (
                    <ChevronRight size={14} className="text-muted-foreground" aria-hidden />
                  ) : null}
                </li>
              );
            })}
          </ol>
        </nav>

        <header className="space-y-2">
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Step {index + 1} of {STEPS.length}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">{step.title}</h1>
          <p className="text-sm text-muted-foreground">{step.description}</p>
        </header>

        <section className="rounded-[var(--radius-lg)] border border-border bg-card p-6 shadow-[var(--shadow-sm)]">
          {step.id === "welcome" ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                ProxyHub is a marketplace for residential and datacenter proxy access. Buyers
                purchase bandwidth; providers earn by sharing capacity.
              </p>
              <div className="grid gap-3">
                <button
                  type="button"
                  onClick={() => goTo(1)}
                  className="rounded-[var(--radius-md)] border border-border p-4 text-left hover:border-[var(--border-strong)] hover:bg-secondary"
                >
                  <h2 className="text-sm font-semibold">Continue as a buyer</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Link your wallet and create your first session.
                  </p>
                </button>
                <Link
                  href={ROUTES.dashboardBecomeProvider}
                  className="rounded-[var(--radius-md)] border border-border p-4 hover:border-[var(--border-strong)] hover:bg-secondary"
                >
                  <h2 className="text-sm font-semibold">I want to provide bandwidth</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Start the provider application instead.
                  </p>
                </Link>
              </div>
            </div>
          ) : null}

          {step.id === "wallet" ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-[var(--radius-md)] border border-border bg-secondary p-4">
                <Wallet className="mt-0.5 h-5 w-5 text-primary" aria-hidden />
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {walletLabel ? "Wallet linked" : "No wallet on this session"}
                  </p>
                  <p className="mt-1 font-mono text-sm text-muted-foreground">
                    {walletLabel ?? "Connect from Settings → Account if needed."}
                  </p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Purchases and escrow use your Solana wallet. You can continue and connect later if
                needed.
              </p>
            </div>
          ) : null}

          {step.id === "first-proxy" ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Browse the marketplace for a listing, or open Connect to start a session with
                defaults.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Link
                  href={ROUTES.marketplace}
                  className="rounded-[var(--radius-md)] border border-border p-4 hover:border-[var(--border-strong)] hover:bg-secondary"
                >
                  <h2 className="text-sm font-semibold">Browse marketplace</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Filter by region, price, and trust.
                  </p>
                </Link>
                <Link
                  href={ROUTES.dashboardProxy}
                  className="rounded-[var(--radius-md)] border border-border p-4 hover:border-[var(--border-strong)] hover:bg-secondary"
                >
                  <h2 className="text-sm font-semibold">Open Connect</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Create a session with guided defaults.
                  </p>
                </Link>
              </div>
            </div>
          ) : null}
        </section>

        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            disabled={index === 0}
            onClick={() => goTo(index - 1)}
          >
            Back
          </Button>
          <div className="flex items-center gap-3">
            <Link href={ROUTES.dashboard} className="text-sm text-muted-foreground hover:underline">
              Skip for now
            </Link>
            {index < STEPS.length - 1 ? (
              <Button type="button" onClick={() => goTo(index + 1)}>
                Continue
              </Button>
            ) : (
              <Button type="button" onClick={() => router.push(ROUTES.dashboard)}>
                Finish
              </Button>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

export default withAuth(OnboardingPageInner);
