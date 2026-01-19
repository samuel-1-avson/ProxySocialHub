import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { GlowButton } from "@/components/ui/glow-button";
import { GlassCard } from "@/components/ui/glass-card";
import { ArrowRight, Shield, Zap, Globe, Wallet } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans selection:bg-primary/20 selection:text-primary overflow-x-hidden">
      {/* Navigation */}
      <Navbar showAuth={false} />

      {/* Hero Section */}
      <main>
        <section className="relative pt-32 pb-24 md:pt-48 md:pb-32 overflow-hidden">
          {/* Background Elements - Pro Max Glows */}
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/10 via-background to-background"></div>
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/20 rounded-full blur-[128px] opacity-40 animate-pulse"></div>
          <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-[128px] opacity-40"></div>

          <div className="container mx-auto px-4 text-center relative z-10">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-card/50 border border-primary/20 text-primary mb-8 shadow-sm backdrop-blur-md animate-fade-in hover:border-primary/40 transition-colors cursor-default">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
              </span>
              <span className="text-sm font-medium tracking-wide">Ghana&apos;s First Social Proxy Marketplace</span>
            </div>

            {/* Headline */}
            <h1 className="text-5xl md:text-7xl lg:text-8xl font-black mb-8 max-w-5xl mx-auto tracking-tight leading-[1.1] drop-shadow-sm">
              Buy. Sell. Connect.
              <br />
              <span className="bg-gradient-to-r from-primary via-emerald-400 to-green-400 bg-clip-text text-transparent animate-shimmer bg-[length:200%_100%]">Proxies Made Social.</span>
            </h1>

            <p className="text-xl md:text-2xl max-w-2xl mx-auto mb-12 text-muted-foreground leading-relaxed">
              Join the community-driven marketplace for reliable proxy bandwidth.
              Trade comfortably, follow providers, and earn passive income.
            </p>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center mb-20">
              <Link href="/marketplace">
                <GlowButton size="lg" variant="primary" icon={<Globe className="w-5 h-5" />}>
                  Browse Marketplace
                </GlowButton>
              </Link>
              <Link href="/dashboard">
                <GlowButton size="lg" variant="outline" icon={<Zap className="w-5 h-5" />}>
                  Start Selling
                </GlowButton>
              </Link>
            </div>

            {/* Stats */}
            <GlassCard className="grid grid-cols-2 md:grid-cols-4 gap-8 max-w-5xl mx-auto p-8 bg-card/30 backdrop-blur-xl border-primary/10">
              {[
                { value: "99.9%", label: "Uptime Guarantee" },
                { value: "<50ms", label: "Low Latency" },
                { value: "100%", label: "Real Residential" },
                { value: "₵0.50", label: "Starting Per GB" },
              ].map((stat) => (
                <div key={stat.label} className="text-center group">
                  <div className="text-3xl md:text-4xl font-black text-foreground mb-1 group-hover:text-primary transition-colors duration-300">{stat.value}</div>
                  <div className="text-xs md:text-sm font-semibold text-muted-foreground uppercase tracking-widest group-hover:text-primary/70 transition-colors">{stat.label}</div>
                </div>
              ))}
            </GlassCard>
          </div>
        </section>

        {/* Features Section */}
        <section className="py-24 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-card/50 to-transparent pointer-events-none"></div>
          <div className="container mx-auto px-4 relative z-10">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-5xl font-bold mb-6 tracking-tight">Why ProxyHub?</h2>
              <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
                We're building a fair, transparent, and social way to share internet access across Ghana.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
              <GlassCard variant="neo" hoverEffect={true} className="p-0">
                <div className="p-8 h-full flex flex-col items-center text-center">
                  <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6 bg-primary/10 text-primary shadow-inner">
                    <Globe className="w-8 h-8" />
                  </div>
                  <h3 className="text-xl font-bold mb-3">Community First</h3>
                  <p className="text-muted-foreground leading-relaxed">
                    Follow your favorite providers, read verified reviews, and chat with sellers directly. Trust is built into the platform.
                  </p>
                </div>
              </GlassCard>

              <GlassCard variant="neo" hoverEffect={true} className="p-0">
                <div className="p-8 h-full flex flex-col items-center text-center">
                  <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6 bg-blue-500/10 text-blue-500 shadow-inner">
                    <Shield className="w-8 h-8" />
                  </div>
                  <h3 className="text-xl font-bold mb-3">Verified Excellence</h3>
                  <p className="text-muted-foreground leading-relaxed">
                    Every provider undergoes strict KYC. Real-time trust scores and performance history mean you always get quality.
                  </p>
                </div>
              </GlassCard>

              <GlassCard variant="neo" hoverEffect={true} className="p-0">
                <div className="p-8 h-full flex flex-col items-center text-center">
                  <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6 bg-yellow-500/10 text-yellow-500 shadow-inner">
                    <Wallet className="w-8 h-8" />
                  </div>
                  <h3 className="text-xl font-bold mb-3">Local Payments</h3>
                  <p className="text-muted-foreground leading-relaxed">
                    Seamlessly pay with MoMo (MTN, Vodafone, AT). Instant deposits for buyers and daily reliable payouts for providers.
                  </p>
                </div>
              </GlassCard>
            </div>
          </div>
        </section>

        {/* How It Works - With Glass Connections */}
        <section className="container mx-auto px-4 py-24">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-bold mb-4 tracking-tight">How It Works</h2>
            <p className="text-muted-foreground text-lg">Get started in minutes, not days.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-12 relative max-w-6xl mx-auto">
            <div className="hidden md:block absolute top-[3.5rem] left-[20%] right-[20%] h-0.5 bg-gradient-to-r from-transparent via-primary/20 to-transparent -z-10"></div>

            {[
              { step: "01", title: "Create Account", desc: "Sign up as a buyer or provider in seconds." },
              { step: "02", title: "Select & Pay", desc: "Browse listings or set your selling price." },
              { step: "03", title: "Start Using", desc: "Connect instantly or start earning passive income." },
            ].map((item, i) => (
              <div key={item.step} className="text-center relative group">
                <div className="w-28 h-28 mx-auto bg-card rounded-full border-4 border-card-border group-hover:border-primary/50 transition-colors flex items-center justify-center mb-8 shadow-xl shadow-primary/5 relative z-10 font-black text-4xl text-primary">
                  {item.step}
                </div>
                <h3 className="text-2xl font-bold mb-3">{item.title}</h3>
                <p className="text-muted-foreground px-4 text-lg">{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Provider CTA - Dark Mode Section */}
        <section className="py-24 bg-secondary text-white overflow-hidden relative isolate">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-primary/20 via-secondary to-secondary -z-10"></div>
          <div className="absolute top-0 right-0 w-1/2 h-full bg-primary/5 skew-x-12 transform translate-x-1/4 blur-3xl -z-10"></div>

          <div className="container mx-auto px-4 relative z-10">
            <div className="grid md:grid-cols-2 gap-16 items-center max-w-6xl mx-auto">
              <div>
                <span className="inline-block px-4 py-1.5 rounded-full bg-primary/20 text-primary-light font-bold text-sm uppercase tracking-wider mb-8 border border-primary/30 shadow-[0_0_15px_-3px_var(--primary)]">
                  For Providers
                </span>
                <h2 className="text-4xl md:text-6xl font-black mb-6 text-white leading-tight">
                  Monetize Your <br />
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary-light to-white">Idle Bandwidth</span>
                </h2>
                <p className="mb-8 text-white/70 text-xl leading-relaxed">
                  Turn your internet connection into a steady passive income stream. Safe, secure, and purely transparent.
                </p>
                <ul className="space-y-4 mb-10">
                  {[
                    "Earn up to GHS 200/month",
                    "Daily payouts directly to MoMo",
                    "Complete control over usage limits",
                    "Community support & bonuses",
                  ].map((item) => (
                    <li key={item} className="flex items-center gap-4 text-lg font-medium text-white/90">
                      <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center flex-shrink-0 text-white shadow-lg shadow-primary/30">
                        <ArrowRight className="w-4 h-4" />
                      </div>
                      {item}
                    </li>
                  ))}
                </ul>
                <Link href="/register?role=provider">
                  <GlowButton size="lg" className="bg-white text-black hover:bg-white/90 shadow-2xl shadow-white/10 border-white/20">
                    Start Earning Today
                  </GlowButton>
                </Link>
              </div>

              <div className="relative">
                <GlassCard variant="ghost" className="bg-white/5 backdrop-blur-md border border-white/10 rounded-3xl p-12 text-center relative z-10 hover:border-white/20 hover:bg-white/10 transition-all duration-500 group">
                  <div className="text-8xl font-black mb-2 text-primary tracking-tighter drop-shadow-[0_0_15px_rgba(16,185,129,0.5)] group-hover:scale-105 transition-transform duration-300">
                    200+
                  </div>
                  <div className="text-2xl font-bold text-white uppercase tracking-widest mb-4">
                    GHS / Month
                  </div>
                  <div className="w-16 h-1 bg-primary/50 mx-auto mb-6 rounded-full"></div>
                  <p className="text-white/60 text-lg">Average earnings for active providers in Ghana</p>
                </GlassCard>
                {/* Decorative elements behind card */}
                <div className="absolute -inset-4 bg-gradient-to-r from-primary/20 to-blue-500/20 rounded-[2.5rem] blur-xl -z-10 opacity-50"></div>
              </div>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="py-16 border-t border-card-border bg-background relative">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom,_var(--tw-gradient-stops))] from-primary/5 via-transparent to-transparent pointer-events-none"></div>
          <div className="container mx-auto px-4 relative z-10">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-12 mb-16">
              <div className="col-span-2 md:col-span-1">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-primary text-white font-bold font-mono text-lg shadow-[4px_4px_0px_var(--foreground)] border border-foreground">
                    PS
                  </div>
                  <span className="font-bold text-xl tracking-tight">ProxyHub</span>
                </div>
                <p className="text-muted-foreground mb-6">
                  Ghana's first community-driven proxy marketplace. Buy, sell, and connect securely.
                </p>
              </div>

              <div>
                <h4 className="font-bold mb-6 text-foreground">Platform</h4>
                <ul className="space-y-4 text-muted-foreground">
                  <li><Link href="/marketplace" className="hover:text-primary transition-colors">Marketplace</Link></li>
                  <li><Link href="/feed" className="hover:text-primary transition-colors">Activity Feed</Link></li>
                  <li><Link href="/register?role=provider" className="hover:text-primary transition-colors">Become a Seller</Link></li>
                </ul>
              </div>

              <div>
                <h4 className="font-bold mb-6 text-foreground">Support</h4>
                <ul className="space-y-4 text-muted-foreground">
                  <li><Link href="/help" className="hover:text-primary transition-colors">Help Center</Link></li>
                  <li><Link href="/guidelines" className="hover:text-primary transition-colors">Community Guidelines</Link></li>
                  <li><Link href="/contact" className="hover:text-primary transition-colors">Contact Us</Link></li>
                </ul>
              </div>

              <div>
                <h4 className="font-bold mb-6 text-foreground">Legal</h4>
                <ul className="space-y-4 text-muted-foreground">
                  <li><Link href="/terms" className="hover:text-primary transition-colors">Terms of Service</Link></li>
                  <li><Link href="/privacy" className="hover:text-primary transition-colors">Privacy Policy</Link></li>
                </ul>
              </div>
            </div>

            <div className="pt-8 border-t border-card-border flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-muted-foreground">
              <p>© 2026 ProxySocialHub. All rights reserved.</p>
              <div className="flex gap-6">
                <a href="#" className="hover:text-foreground transition-colors">𝕏</a>
                <a href="#" className="hover:text-foreground transition-colors">Instagram</a>
                <a href="#" className="hover:text-foreground transition-colors">LinkedIn</a>
              </div>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}

