import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans selection:bg-primary/20 selection:text-primary">
      {/* Navigation */}
      <Navbar showAuth={false} />

      {/* Hero Section */}
      <main>
        <section className="relative pt-32 pb-24 md:pt-48 md:pb-32 overflow-hidden">
          {/* Background Elements */}
          <div className="absolute inset-0 -z-10">
            <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/20 rounded-full blur-[128px] opacity-50 animate-pulse"></div>
            <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-[128px] opacity-50"></div>
          </div>

          <div className="container mx-auto px-4 text-center relative z-10">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-card border border-primary/20 text-primary mb-8 shadow-sm backdrop-blur-sm animate-fade-in">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
              </span>
              <span className="text-sm font-medium tracking-wide">Ghana&apos;s First Social Proxy Marketplace</span>
            </div>

            {/* Headline */}
            <h1 className="text-5xl md:text-7xl lg:text-8xl font-black mb-8 max-w-5xl mx-auto tracking-tight leading-[1.1]">
              Buy. Sell. Connect.
              <br />
              <span className="bg-gradient-to-r from-primary to-green-400 bg-clip-text text-transparent">Proxies Made Social.</span>
            </h1>

            <p className="text-xl md:text-2xl max-w-2xl mx-auto mb-12 text-muted-foreground leading-relaxed">
              Join the community-driven marketplace for reliable proxy bandwidth.
              Trade comfortably, follow providers, and earn passive income.
            </p>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center mb-20">
              <Link href="/marketplace">
                <Button size="lg" className="w-full sm:w-auto text-lg px-8 py-6 shadow-lg shadow-primary/20 hover:shadow-primary/40 hover:-translate-y-1 transition-all rounded-full font-bold">
                  Browse Marketplace
                </Button>
              </Link>
              <Link href="/dashboard">
                <Button variant="outline" size="lg" className="w-full sm:w-auto text-lg px-8 py-6 bg-card/50 backdrop-blur border-2 hover:bg-card/80 hover:-translate-y-1 transition-all rounded-full font-bold">
                  Start Selling
                </Button>
              </Link>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8 max-w-5xl mx-auto p-8 rounded-3xl bg-card/30 backdrop-blur border border-card-border/50">
              {[
                { value: "99.9%", label: "Uptime Guarantee" },
                { value: "<50ms", label: "Low Latency" },
                { value: "100%", label: "Real Residential" },
                { value: "₵0.50", label: "Starting Per GB" },
              ].map((stat) => (
                <div key={stat.label} className="text-center group">
                  <div className="text-3xl md:text-4xl font-black text-foreground mb-1 group-hover:text-primary transition-colors">{stat.value}</div>
                  <div className="text-xs md:text-sm font-semibold text-muted-foreground uppercase tracking-widest">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section className="py-24 bg-card/50 border-y border-card-border">
          <div className="container mx-auto px-4">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-5xl font-bold mb-6">Why ProxyHub?</h2>
              <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
                We're building a fair, transparent, and social way to share internet access across Ghana.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
              {/* Feature 1 */}
              <div className="p-8 rounded-2xl bg-background border border-card-border shadow-sm hover:shadow-lg hover:border-primary/20 transition-all group">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-6 bg-primary/10 text-primary group-hover:bg-primary group-hover:text-white transition-colors">
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold mb-3">Community First</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Follow your favorite providers, read verified reviews, and chat with sellers directly. Trust is built into the platform.
                </p>
              </div>

              {/* Feature 2 */}
              <div className="p-8 rounded-2xl bg-background border border-card-border shadow-sm hover:shadow-lg hover:border-primary/20 transition-all group">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-6 bg-blue-500/10 text-blue-500 group-hover:bg-blue-500 group-hover:text-white transition-colors">
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold mb-3">Verified Excellence</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Every provider undergoes strict KYC. Real-time trust scores and performance history mean you always get quality.
                </p>
              </div>

              {/* Feature 3 */}
              <div className="p-8 rounded-2xl bg-background border border-card-border shadow-sm hover:shadow-lg hover:border-primary/20 transition-all group">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-6 bg-yellow-500/10 text-yellow-500 group-hover:bg-yellow-500 group-hover:text-white transition-colors">
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold mb-3">Local Payments</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Seamlessly pay with MoMo (MTN, Vodafone, AT). Instant deposits for buyers and daily reliable payouts for providers.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section className="container mx-auto px-4 py-24">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-bold mb-4">How It Works</h2>
            <p className="text-muted-foreground">Get started in minutes, not days.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-12 relative max-w-6xl mx-auto">
            {/* Connector Line (Desktop) */}
            <div className="hidden md:block absolute top-[3.5rem] left-[20%] right-[20%] h-0.5 bg-gradient-to-r from-transparent via-card-border to-transparent -z-10"></div>

            {[
              { step: "01", title: "Create Account", desc: "Sign up as a buyer or provider in seconds." },
              { step: "02", title: "Select & Pay", desc: "Browse listings or set your selling price." },
              { step: "03", title: "Start Using", desc: "Connect instantly or start earning passive income." },
            ].map((item, i) => (
              <div key={item.step} className="text-center relative">
                <div className="w-28 h-28 mx-auto bg-background rounded-full border-8 border-card-border flex items-center justify-center mb-8 shadow-sm relative z-10 font-black text-4xl text-primary">
                  {item.step}
                </div>
                <h3 className="text-2xl font-bold mb-3">{item.title}</h3>
                <p className="text-muted-foreground px-4 text-lg">{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Provider CTA */}
        <section className="py-24 bg-foreground text-background overflow-hidden relative">
          <div className="absolute top-0 right-0 w-1/2 h-full bg-primary/10 skew-x-12 transform translate-x-1/4"></div>

          <div className="container mx-auto px-4 relative z-10">
            <div className="grid md:grid-cols-2 gap-16 items-center max-w-6xl mx-auto">
              <div>
                <span className="inline-block px-4 py-1.5 rounded-full bg-primary/20 text-primary-light font-bold text-sm uppercase tracking-wider mb-8 border border-primary/30">
                  For Providers
                </span>
                <h2 className="text-4xl md:text-6xl font-black mb-6 text-white leading-tight">
                  Monetize Your <br />
                  <span className="text-primary">Idle Bandwidth</span>
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
                      <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center flex-shrink-0 text-white">
                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                      {item}
                    </li>
                  ))}
                </ul>
                <Link href="/register?role=provider">
                  <Button size="lg" className="bg-white text-black hover:bg-gray-100 border-none shadow-xl text-lg px-10 py-6 font-bold rounded-full">
                    Start Earning Today
                  </Button>
                </Link>
              </div>

              <div className="relative animate-fade-in-up">
                <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-3xl p-12 text-center relative z-10 hover:transform hover:scale-105 transition-transform duration-500">
                  <div className="text-8xl font-black mb-2 text-primary tracking-tighter drop-shadow-lg">
                    200+
                  </div>
                  <div className="text-2xl font-bold text-white uppercase tracking-widest mb-4">
                    GHS / Month
                  </div>
                  <div className="w-16 h-1 bg-primary mx-auto mb-6"></div>
                  <p className="text-white/60 text-lg">Average earnings for active providers in Ghana</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="py-16 border-t border-card-border bg-background">
          <div className="container mx-auto px-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-12 mb-16">
              <div className="col-span-2 md:col-span-1">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-primary text-white font-bold font-mono text-lg shadow-retro">
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

