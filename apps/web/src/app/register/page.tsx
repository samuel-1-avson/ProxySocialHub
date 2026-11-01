"use client";

import dynamic from "next/dynamic";
import { AuthMethodDivider, GoogleSignInButton, googleSignInEnabled } from "@/components/auth/GoogleSignInButton";
import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";
import { Check } from "lucide-react";
import { WalletBoundary } from "@/providers/WalletBoundary";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import {
  captureReferralCodeFromSearch,
  peekReferralCode,
} from "@/lib/referral";
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

const steps = [
  "Connect your Solana wallet",
  "Sign the verification message",
  "Your account is created instantly",
];

export default function RegisterPage() {
  const referralCode = useSyncExternalStore(
    subscribeToReferral,
    getReferralSnapshot,
    () => null,
  );

  useEffect(() => {
    captureReferralCodeFromSearch();
    window.dispatchEvent(new Event("proxyhubb:referral-update"));
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingHeader />
      <main id="main-content" tabIndex={-1} className="auth-layout">
        <aside className="auth-story" aria-label="About ProxyHubb access">
          <div className="auth-story-copy">
            <p className="landing-section-kicker">
              GET CONNECTED / PROVIDE OR BUY
            </p>
            <h2>
              Bring your wallet.
              <br />
              <span>Find your place in the network.</span>
            </h2>
            <p>
              Create one account, then choose a buyer or provider workspace for
              your next step.
            </p>
          </div>
          <div className="auth-story-footer">
            ACCESS CONTROL / WALLET SIGN-IN
          </div>
        </aside>
        <section className="auth-main" aria-labelledby="register-title">
          <div className="auth-panel">
            <p className="landing-section-kicker">NEW ACCOUNT / REGISTER</p>
            <h1 id="register-title">Create your account</h1>
            <p>Connect a Solana wallet to create your ProxyHubb account.</p>
            {referralCode ? (
              <p className="auth-referral-note">
                Invite code <code>{referralCode}</code> will apply on first
                signup.
              </p>
            ) : null}
            <div className="auth-card">
              <ol className="auth-steps">
                {steps.map((step, index) => (
                  <li key={step}>
                    <span>
                      <Check size={14} aria-hidden="true" />
                    </span>
                    <span>
                      <small>STEP 0{index + 1}</small>
                      {step}
                    </span>
                  </li>
                ))}
              </ol>
              <WalletBoundary>
                <GoogleSignInButton text="signup_with" />
                  {googleSignInEnabled && <AuthMethodDivider />}
                  <WalletAuthPanel
                  mode="register"
                  actionLabel="Create account with wallet"
                />
              </WalletBoundary>
            </div>
            <p className="auth-switch">
              Already have an account? <Link href={ROUTES.login}>Sign in</Link>
            </p>
            <p className="auth-legal">
              By connecting your wallet, you agree to the{" "}
              <Link className="underline underline-offset-4" href={ROUTES.terms}>Terms of Service</Link> and{" "}
              <Link className="underline underline-offset-4" href={ROUTES.privacy}>Privacy Policy</Link>.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}

function subscribeToReferral(onStoreChange: () => void) {
  window.addEventListener("popstate", onStoreChange);
  window.addEventListener("proxyhubb:referral-update", onStoreChange);
  return () => {
    window.removeEventListener("popstate", onStoreChange);
    window.removeEventListener("proxyhubb:referral-update", onStoreChange);
  };
}

function getReferralSnapshot() {
  const params = new URLSearchParams(window.location.search);
  const queryCode =
    params.get("ref") || params.get("referral") || params.get("referral_code");
  return queryCode?.trim().toUpperCase() || peekReferralCode();
}
