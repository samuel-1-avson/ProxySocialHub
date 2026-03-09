"use client";

import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { NetworkFeed } from "@/components/NetworkFeed";
import { ArrowRight, Shield, Zap, Globe, Wallet, ExternalLink, Activity } from "lucide-react";
import { useAuth } from "@/lib/auth";

export default function Home() {
  const { user } = useAuth();
  return (
    <div className="min-h-screen bg-background text-foreground font-sans selection:bg-primary/20 selection:text-primary overflow-x-hidden">
      {/* Navigation */}
      <Navbar showAuth={false} />

      {/* Hero Section */}
      <main>
        <section className="relative pt-32 pb-24 md:pt-48 md:pb-32 border-b border-border bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]">
          <div className="container mx-auto px-4 text-center relative z-10">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-sm bg-accent border border-border text-foreground mb-8 text-xs font-mono tracking-wide">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
              </span>
              <span>GHANA_SOCIAL_PROXY_MARKETPLACE_V1.0</span>
            </div>

            {/* Headline */}
            <h1 className="text-5xl md:text-7xl lg:text-8xl font-bold mb-8 max-w-5xl mx-auto tracking-tight leading-[1] font-mono text-foreground">
              BUY. SELL. <span className="text-primary underline decoration-4 underline-offset-4 decoration-primary/30">CONNECT.</span>
              <br />
              <span className="text-muted-foreground">PROXIES MADE SOCIAL.</span>
            </h1>

            <p className="text-xl md:text-2xl max-w-2xl mx-auto mb-12 text-muted-foreground leading-relaxed font-sans">
              Join the community-driven marketplace for reliable proxy bandwidth.
              Trade comfortably, follow providers, and earn passive income.
            </p>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row gap-6 justify-center mb-24 relative z-20">
              <Link href="/marketplace">
                <button className="btn-retro btn-retro-primary px-8 py-4 text-lg w-full sm:w-auto h-full flex items-center justify-center">
                  <Globe className="w-5 h-5 mr-2" />
                  BROWSE MARKETPLACE
                </button>
              </Link>
              {user ? (
                <Link href="/dashboard">
                  <button className="btn-retro btn-retro-outline px-8 py-4 text-lg w-full sm:w-auto bg-background h-full flex items-center justify-center">
                    <Activity className="w-5 h-5 mr-2" />
                    SYSTEM DASHBOARD
                  </button>
                </Link>
              ) : (
                <Link href="/login">
                  <button className="btn-retro btn-retro-outline px-8 py-4 text-lg w-full sm:w-auto bg-background h-full flex items-center justify-center">
                    <ExternalLink className="w-5 h-5 mr-2" />
                    ACCESS TERMINAL
                  </button>
                </Link>
              )}
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-0 max-w-5xl mx-auto border border-border bg-card rounded-lg overflow-hidden shadow-sm mb-12">
              {[
                { value: "99.9%", label: "UPTIME" },
                { value: "<50ms", label: "LATENCY" },
                { value: "100%", label: "RESIDENTIAL" },
                { value: "₵0.50", label: "PER GB" },
              ].map((stat, i) => (
                <div key={stat.label} className={`p-8 text-center group border-r border-border last:border-r-0 hover:bg-accent/50 transition-colors`}>
                  <div className="text-3xl md:text-4xl font-bold text-foreground mb-2 group-hover:text-primary transition-colors font-mono">{stat.value}</div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">{stat.label}</div>
                </div>
              ))}
            </div>

            {/* Live Feed */}
            <div className="max-w-3xl mx-auto">
              <NetworkFeed />
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section className="py-24 border-b border-border bg-secondary/30">
          <div className="container mx-auto px-4">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold mb-4 tracking-tight font-mono uppercase">Why ProxyHub?</h2>
              <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
                Fair, transparent, and decentralized internet access.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
              {[
                { icon: <Globe className="w-6 h-6" />, title: "Community First", desc: "Follow providers, read reviews, and chat directly. Trust is built-in." },
                { icon: <Shield className="w-6 h-6" />, title: "Verified Excellence", desc: "Strict KYC and real-time trust scores ensure you get quality bandwidth." },
                { icon: <Wallet className="w-6 h-6" />, title: "Local Payments", desc: "Seamless MoMo payments. Instant deposits and daily payouts." },
              ].map((feature, i) => (
                <div key={i} className="card-retro p-8 bg-card h-full flex flex-col items-start hover:shadow-retro hover:-translate-y-1 transition-all duration-200">
                  <div className="w-12 h-12 rounded-sm border border-border flex items-center justify-center mb-6 bg-background text-primary shadow-sm">
                    {feature.icon}
                  </div>
                  <h3 className="text-xl font-bold mb-3 font-mono">{feature.title}</h3>
                  <p className="text-muted-foreground leading-relaxed">
                    {feature.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section className="py-24 border-b border-border">
          <div className="container mx-auto px-4">
            <div className="flex flex-col md:flex-row gap-16 items-center max-w-6xl mx-auto">
              <div className="flex-1">
                <h2 className="text-3xl md:text-5xl font-bold mb-6 tracking-tight font-mono">HOW IT WORKS</h2>
                <p className="text-xl text-muted-foreground mb-8">Get started in minutes. No complex setup required.</p>

                <div className="space-y-8">
                  {[
                    { step: "01", title: "Create Account", desc: "Sign up as a buyer or provider." },
                    { step: "02", title: "Select & Pay", desc: "Browse listings or set your price." },
                    { step: "03", title: "Start Using", desc: "Connect instantly or earn income." },
                  ].map((item) => (
                    <div key={item.step} className="flex gap-6 items-start">
                      <div className="font-mono text-4xl font-bold text-border text-stroke stroke-foreground">{item.step}</div>
                      <div>
                        <h3 className="text-xl font-bold font-mono">{item.title}</h3>
                        <p className="text-muted-foreground">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex-1 w-full relative">
                <div className="card-retro aspect-square flex items-center justify-center bg-secondary/50 border-dashed border-2 relative overflow-hidden">
                  <div className="absolute inset-0 grid grid-cols-6 grid-rows-6">
                    {[...Array(36)].map((_, i) => (
                      <div key={i} className="border-r border-b border-border/50"></div>
                    ))}
                  </div>
                  <div className="relative z-10 text-center">
                    <div className="w-24 h-24 bg-card border border-border mx-auto mb-4 flex items-center justify-center rounded-full shadow-retro">
                      <Zap className="w-10 h-10 text-primary" />
                    </div>
                    <div className="font-mono text-sm bg-card px-2 border border-border inline-block">SYSTEM_READY</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="py-16 bg-card border-t border-border">
          <div className="container mx-auto px-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-12 mb-16">
              <div className="col-span-2 md:col-span-1">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-sm flex items-center justify-center bg-primary text-primary-foreground font-bold font-mono text-lg shadow-[3px_3px_0px_var(--foreground)] border border-foreground">
                    PS
                  </div>
                  <span className="font-bold text-xl tracking-tight font-mono">ProxyHub</span>
                </div>
                <p className="text-muted-foreground mb-6 font-mono text-sm">
                  GHANA_SOCIAL_PROXY_MARKETPLACE<br />
                  EST. 2026
                </p>
              </div>

              <div>
                <h4 className="font-bold mb-6 text-foreground font-mono uppercase text-sm">Platform</h4>
                <ul className="space-y-3 text-muted-foreground text-sm">
                  <li><Link href="/marketplace" className="hover:text-primary transition-colors hover:underline">Marketplace</Link></li>
                  <li><Link href="/feed" className="hover:text-primary transition-colors hover:underline">Activity Feed</Link></li>
                  <li><Link href="/register?role=provider" className="hover:text-primary transition-colors hover:underline">Become a Seller</Link></li>
                </ul>
              </div>

              <div>
                <h4 className="font-bold mb-6 text-foreground font-mono uppercase text-sm">Support</h4>
                <ul className="space-y-3 text-muted-foreground text-sm">
                  <li><Link href="/help" className="hover:text-primary transition-colors hover:underline">Help Center</Link></li>
                  <li><Link href="/guidelines" className="hover:text-primary transition-colors hover:underline">Community Guidelines</Link></li>
                  <li><Link href="/contact" className="hover:text-primary transition-colors hover:underline">Contact Us</Link></li>
                </ul>
              </div>

              <div>
                <h4 className="font-bold mb-6 text-foreground font-mono uppercase text-sm">Legal</h4>
                <ul className="space-y-3 text-muted-foreground text-sm">
                  <li><Link href="/terms" className="hover:text-primary transition-colors hover:underline">Terms of Service</Link></li>
                  <li><Link href="/privacy" className="hover:text-primary transition-colors hover:underline">Privacy Policy</Link></li>
                </ul>
              </div>
            </div>

            <div className="pt-8 border-t border-border flex flex-col md:flex-row justify-between items-center gap-4 text-xs font-mono text-muted-foreground">
              <p>© 2026 PROXYSOCIALHUB. ALL RIGHTS RESERVED.</p>
              <div className="flex gap-6 uppercase">
                <a href="#" className="hover:text-foreground transition-colors hover:underline">Twitter</a>
                <a href="#" className="hover:text-foreground transition-colors hover:underline">Instagram</a>
                <a href="#" className="hover:text-foreground transition-colors hover:underline">LinkedIn</a>
              </div>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}

