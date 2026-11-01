"use client";

import dynamic from "next/dynamic";
import { AuthMethodDivider, GoogleSignInButton, googleSignInEnabled } from "@/components/auth/GoogleSignInButton";
import Link from "next/link";
import { WalletBoundary } from "@/providers/WalletBoundary";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import { ROUTES } from "@/lib/navigation/routes";

const WalletAuthPanel = dynamic(
  () =>
    import("@/components/WalletAuthPanel").then((mod) => mod.WalletAuthPanel),
  {
    ssr: false,
    loading: () => (
      <div
        className="flex min-h-[160px] items-center justify-center rounded-[var(--radius-md)] border border-border bg-card text-sm text-muted-foreground"
        role="status"
      >
        Initializing wallet access…
      </div>
    ),
  },
);

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingHeader />
      <main id="main-content" tabIndex={-1} className="auth-layout">
        <aside className="auth-story" aria-label="About ProxyHubb access">
          <div className="auth-story-copy">
            <p className="landing-section-kicker">WALLET / ACCESS</p>
            <h2>
              One signature.
              <br />
              <span>Your network workspace.</span>
            </h2>
            <p>
              Use your Solana wallet to manage proxy connections, offers, and
              network activity from one place.
            </p>
          </div>
          <div className="auth-story-footer">
            ACCESS CONTROL / WALLET SIGN-IN
          </div>
        </aside>
        <section className="auth-main" aria-labelledby="login-title">
          <div className="auth-panel">
            <p className="landing-section-kicker">RETURNING USER / LOGIN</p>
            <h1 id="login-title">Sign in</h1>
            <p>
              {googleSignInEnabled
                ? "Continue with Google, or connect your Solana wallet."
                : "Connect the Solana wallet associated with your ProxyHubb account."}
            </p>
            <div className="auth-card">
              <WalletBoundary>
                <GoogleSignInButton text="signin_with" />
                  {googleSignInEnabled && <AuthMethodDivider />}
                  <WalletAuthPanel
                  mode="login"
                  actionLabel="Sign in with wallet"
                  idleMessage="Connect your Solana wallet to continue"
                />
              </WalletBoundary>
            </div>
            <p className="auth-switch">
              New to ProxyHubb?{" "}
              <Link href={ROUTES.register}>Create an account</Link>
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
