"use client";
import { explorerHref } from "@/lib/navigation/workspace";

import Link from "next/link";
import { ArrowRight, ArrowUpRight, Cable, Server, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import { LandingHeroVisual } from "@/components/marketing/LandingHeroVisual";
import {
  FOOTER_LEGAL_LINKS,
  FOOTER_PLATFORM_LINKS,
  FOOTER_SUPPORT_LINKS,
  ROUTES,
} from "@/lib/navigation/routes";

const steps = [
  {
    number: "01",
    title: "Connect a wallet",
    description: "Sign in with Solana and enter your workspace without a password or email gate.",
  },
  {
    number: "02",
    title: "Choose a route",
    description: "Compare provider offers by price, capacity, location, and published terms.",
  },
  {
    number: "03",
    title: "Stay in control",
    description: "Use a supported gateway, then review session status and reported usage in Activity.",
  },
];

const proofPoints = [
  { label: "Access", value: "Wallet-native", icon: ShieldCheck },
  { label: "Protocol", value: "CONNECT", icon: Cable },
  { label: "Supply", value: "Provider-run nodes", icon: Server },
];

export default function Home() {
  const { user, isLoading } = useAuth();
  const primaryHref = user ? ROUTES.workspace : ROUTES.register;
  const primaryLabel = user ? "Open workspace" : "Connect your wallet";

  return (
    <div className="landing-page min-h-screen bg-background text-foreground">
      <MarketingHeader />

      <main id="main-content" tabIndex={-1}>
        <section className="landing-hero">
          <div className="landing-hero-orbit" aria-hidden="true" />
          <div className="landing-hero-inner">
            <div className="landing-hero-copy">
              <p className="landing-kicker"><span /> Proxy capacity / connected</p>
              <h1>
                Clear routes.
                <br />
                <span>Confident connections.</span>
              </h1>
              <p className="landing-lede">
                Compare provider offers, connect through a supported gateway, and follow session status and reported usage from one workspace.
              </p>
              <div className="landing-actions">
                <Link href={ROUTES.marketplace} className="landing-button landing-button-primary">
                  Browse marketplace <ArrowRight size={17} aria-hidden="true" />
                </Link>
                <Link href={explorerHref()} className="landing-button landing-button-secondary">
                  Explore the network <ArrowUpRight size={16} aria-hidden="true" />
                </Link>
              </div>
              <p className="landing-note">
                {isLoading ? "Checking your workspace…" : user ? primaryLabel : "Wallet sign-in · no password"}
                {!isLoading && user ? <Link href={primaryHref}>Continue <ArrowRight size={13} aria-hidden="true" /></Link> : null}
              </p>
            </div>
            <div className="landing-hero-art">
              <LandingHeroVisual />
            </div>
          </div>
          <div className="landing-hero-footer">
            <span>BUYER → GATEWAY → PROVIDER</span>
            <span>NETWORK ACCESS / DEVNET</span>
          </div>
        </section>

        <section className="landing-proof" aria-label="Platform capabilities">
          <div className="landing-proof-inner">
            {proofPoints.map(({ label, value, icon: Icon }) => (
              <div key={label} className="landing-proof-item">
                <span className="landing-proof-icon"><Icon size={17} aria-hidden="true" /></span>
                <div>
                  <p>{label}</p>
                  <strong>{value}</strong>
                </div>
                <span className="landing-proof-rule" aria-hidden="true" />
              </div>
            ))}
          </div>
        </section>

        <section className="landing-section landing-process">
          <div className="landing-section-heading">
            <div>
              <p className="landing-section-kicker">A path you can follow</p>
              <h2>From offer to active session.</h2>
            </div>
            <p>Each step has a place in the product, so buyers and providers can keep track of what happens next.</p>
          </div>
          <ol className="landing-step-grid">
            {steps.map((step) => (
              <li key={step.number} className="landing-step-card">
                <span className="landing-step-number">{step.number}</span>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="landing-audience-section">
          <div className="landing-audience-inner">
            <article className="landing-audience-card landing-buyer-card">
              <p className="landing-section-kicker">For buyers / discover and connect</p>
              <div className="landing-audience-icon"><Cable size={23} aria-hidden="true" /></div>
              <h2>Find the right capacity for the work.</h2>
              <p>Compare published location, price, capacity, and terms. Keep orders, connection details, and reported usage together.</p>
              <Link href={ROUTES.marketplace}>
                Browse marketplace <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <span className="landing-card-index">01 — BUYER WORKSPACE</span>
            </article>
            <article className="landing-audience-card landing-provider-card">
              <p className="landing-section-kicker">For providers / publish supply</p>
              <div className="landing-audience-icon"><Server size={23} aria-hidden="true" /></div>
              <h2>Bring your nodes into the network.</h2>
              <p>Register nodes, shape your offer, and review activity and earnings from the provider workspace.</p>
              <Link href={ROUTES.seller}>
                Explore provider tools <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <span className="landing-card-index">02 — PROVIDER WORKSPACE</span>
            </article>
          </div>
        </section>

        <section className="landing-records">
          <div className="landing-records-content">
            <div>
              <p className="landing-section-kicker">Public network records</p>
              <h2>Inspect the network without signing in.</h2>
              <p>Explore reported nodes, indexed ledger records, network health, and governance activity in one public surface.</p>
            </div>
            <div className="landing-record-links">
              <Link href={explorerHref()} className="landing-button landing-button-primary">
                Open Explorer <ArrowUpRight size={16} aria-hidden="true" />
              </Link>
              <Link href={ROUTES.explorerHealth} className="landing-record-secondary">Network health <ArrowRight size={15} aria-hidden="true" /></Link>
            </div>
          </div>
          <div className="landing-record-stamp" aria-hidden="true">PUBLIC<br />BY DESIGN</div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-footer-grid">
          <div className="landing-footer-brand">
            <Link href={ROUTES.home} className="marketing-brand">
              <span className="marketing-brand-mark" aria-hidden="true">PH</span>
              <span className="marketing-brand-name">ProxyHubb</span>
            </Link>
            <p>Proxy infrastructure, with a clear line from offer to usage.</p>
          </div>
          <div>
            <h3>Platform</h3>
            <ul>{FOOTER_PLATFORM_LINKS.map((item) => <li key={item.href}><Link href={item.href}>{item.label}</Link></li>)}</ul>
          </div>
          <div>
            <h3>Support</h3>
            <ul>{FOOTER_SUPPORT_LINKS.map((item) => <li key={item.href}><Link href={item.href}>{item.label}</Link></li>)}</ul>
          </div>
          <div>
            <h3>Legal</h3>
            <ul>{FOOTER_LEGAL_LINKS.map((item) => <li key={item.href}><Link href={item.href}>{item.label}</Link></li>)}</ul>
          </div>
        </div>
        <div className="landing-footer-bottom">
          <span>© {new Date().getFullYear()} ProxyHubb</span>
          <span>NETWORK ACCESS / DEVNET</span>
        </div>
      </footer>
    </div>
  );
}
