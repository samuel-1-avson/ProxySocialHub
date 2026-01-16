import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export default function Home() {
  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] font-sans selection:bg-[var(--primary-light)] selection:text-[var(--primary-dark)]">
      {/* Navigation */}
      <Navbar showAuth={false} />

      {/* Hero Section */}
      <main>
        <section className="container mx-auto px-4 py-24 md:py-32 text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--card)] border border-[var(--primary-light)] text-[var(--primary)] mb-8 shadow-sm animate-fade-in">
            <span className="w-2.5 h-2.5 rounded-full bg-[var(--primary)] animate-pulse"></span>
            <span className="text-sm font-medium tracking-wide">Ghana&apos;s First Social Proxy Marketplace</span>
          </div>

          {/* Headline */}
          <h1 className="text-5xl md:text-7xl font-bold mb-8 max-w-4xl mx-auto tracking-tight leading-[1.1]">
            Buy. Sell. Connect.
            <br />
            <span className="text-[var(--primary)] underline decoration-[var(--primary-light)] underline-offset-8">Proxies Made Social.</span>
          </h1>

          <p className="text-lg md:text-xl max-w-2xl mx-auto mb-12 text-[var(--text-secondary)] leading-relaxed">
            Join the community-driven marketplace for reliable proxy bandwidth.
            Follow trusted providers, trade comfortably, and earn passive income from your connection.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row gap-6 justify-center mb-20">
            <Link href="/register?role=buyer">
              <Button size="lg" className="w-full sm:w-auto text-lg px-8 shadow-[var(--shadow-retro)] hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px] transition-all border-2 border-[var(--primary-dark)]">
                Browse Marketplace
              </Button>
            </Link>
            <Link href="/register?role=provider">
              <Button variant="secondary" size="lg" className="w-full sm:w-auto text-lg px-8 shadow-[var(--shadow-retro)] hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px] transition-all border-2 border-[var(--secondary)]">
                Start Selling
              </Button>
            </Link>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 max-w-4xl mx-auto">
            {[
              { value: "99.9%", label: "Uptime" },
              { value: "<50ms", label: "Latency" },
              { value: "100%", label: "Residential" },
              { value: "₵0.50", label: "Per GB" },
            ].map((stat) => (
              <div key={stat.label} className="text-center p-4 rounded-[var(--radius)] hover:bg-white/50 transition-colors">
                <div className="text-3xl md:text-4xl font-bold text-[var(--foreground)] mb-1">{stat.value}</div>
                <div className="text-sm font-medium text-[var(--text-secondary)] uppercase tracking-wider">{stat.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Features Section */}
        <section className="py-24 bg-[var(--card)] border-y border-[var(--card-border)]">
          <div className="container mx-auto px-4">
            <h2 className="text-3xl md:text-4xl font-bold text-center mb-4">
              Why ProxyHub?
            </h2>
            <p className="text-center mb-16 max-w-lg mx-auto text-[var(--text-secondary)] text-lg">
              A fair, transparent, and social way to share internet access.
            </p>

            <div className="grid md:grid-cols-3 gap-8">
              {/* Feature 1 */}
              <Card variant="retro" hoverEffect className="group">
                <div className="w-12 h-12 rounded-[var(--radius-sm)] flex items-center justify-center mb-6 bg-[var(--primary-light)]/30 text-[var(--primary)] group-hover:scale-110 transition-transform">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold mb-3">Social Marketplace</h3>
                <p className="text-[var(--text-secondary)] leading-relaxed">
                  Follow your favorite providers, read verified reviews, and build connections within the community before you purchase.
                </p>
              </Card>

              {/* Feature 2 */}
              <Card variant="retro" hoverEffect className="group">
                <div className="w-12 h-12 rounded-[var(--radius-sm)] flex items-center justify-center mb-6 bg-[var(--success)]/20 text-[var(--success)] group-hover:scale-110 transition-transform">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold mb-3">Verified Providers</h3>
                <p className="text-[var(--text-secondary)] leading-relaxed">
                  Every provider undergoes strict KYC verification. Trust scores and transparent history ensure you get quality bandwidth.
                </p>
              </Card>

              {/* Feature 3 */}
              <Card variant="retro" hoverEffect className="group">
                <div className="w-12 h-12 rounded-[var(--radius-sm)] flex items-center justify-center mb-6 bg-[var(--info)]/20 text-[var(--info)] group-hover:scale-110 transition-transform">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold mb-3">MoMo Payments</h3>
                <p className="text-[var(--text-secondary)] leading-relaxed">
                  Seamlessly pay with MTN, Vodafone, or AirtelTigo mobile money. Instant deposits and daily payouts for providers.
                </p>
              </Card>
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section className="container mx-auto px-4 py-24">
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-16">
            How It Works
          </h2>

          <div className="grid md:grid-cols-3 gap-12 relative">
            {/* Connector Line (Desktop) */}
            <div className="hidden md:block absolute top-12 left-[16%] right-[16%] h-0.5 bg-[var(--card-border)] -z-10"></div>

            {[
              { step: "01", title: "Browse Providers", desc: "Explore listings from verified Ghana proxy providers." },
              { step: "02", title: "Choose & Purchase", desc: "Select bandwidth, pay with MoMo, get instant access." },
              { step: "03", title: "Rate & Review", desc: "Share your experience and help the community grow." },
            ].map((item) => (
              <div key={item.step} className="text-center relative">
                <div className="w-24 h-24 mx-auto bg-[var(--background)] rounded-full border-4 border-[var(--card-border)] flex items-center justify-center mb-6 shadow-sm">
                  <span className="text-3xl font-black text-[var(--primary)]">{item.step}</span>
                </div>
                <h3 className="text-xl font-bold mb-3">{item.title}</h3>
                <p className="text-[var(--text-secondary)] px-4">{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Provider CTA */}
        <section className="py-24 bg-[var(--foreground)] text-[var(--background)]">
          <div className="container mx-auto px-4">
            <div className="grid md:grid-cols-2 gap-16 items-center">
              <div>
                <div className="inline-block px-3 py-1 rounded-full bg-[var(--success)]/20 text-[var(--success)] text-xs font-bold uppercase tracking-wider mb-6 border border-[var(--success)]/30">
                  For Providers
                </div>
                <h2 className="text-3xl md:text-5xl font-bold mb-6 text-white leading-tight">
                  Turn Your Internet into Income
                </h2>
                <p className="mb-8 text-[var(--text-muted)] text-lg leading-relaxed">
                  Share your unused bandwidth and earn daily payouts directly to your mobile money.
                  It&apos;s safe, secure, and completely passive.
                </p>
                <ul className="space-y-4 mb-10">
                  {[
                    "Earn GHS 0.20 per GB shared",
                    "Daily payouts via MoMo",
                    "Build your reputation & followers",
                    "Set your own prices",
                  ].map((item) => (
                    <li key={item} className="flex items-center gap-3 text-lg">
                      <div className="w-6 h-6 rounded-full bg-[var(--success)] flex items-center justify-center flex-shrink-0 text-[var(--bg-primary)]">
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                      {item}
                    </li>
                  ))}
                </ul>
                <Link href="/register?role=provider">
                  <Button size="lg" className="bg-white text-[var(--foreground)] hover:bg-gray-100 border-none shadow-lg text-lg px-8">
                    Start Earning Today
                  </Button>
                </Link>
              </div>
              <div className="relative">
                <div className="absolute inset-0 bg-[var(--primary)] rounded-[var(--radius-lg)] rotate-3 opacity-20 transform translate-x-4 translate-y-4"></div>
                <div className="bg-[var(--card-border)]/10 backdrop-blur-sm border border-white/10 rounded-[var(--radius-lg)] p-12 text-center relative z-10">
                  <div className="text-7xl font-black mb-2 text-[var(--primary)] tracking-tighter">
                    200+
                  </div>
                  <div className="text-xl font-medium text-white/80 uppercase tracking-widest">
                    GHS / Month
                  </div>
                  <p className="mt-4 text-white/50 text-sm">Average earnings for active providers</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="py-12 border-t border-[var(--card-border)] bg-[var(--background)]">
          <div className="container mx-auto px-4">
            <div className="flex flex-col md:flex-row items-center justify-between gap-8">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-[var(--radius-sm)] flex items-center justify-center bg-[var(--primary)] shadow-sm">
                  <span className="text-white font-bold text-xs">PS</span>
                </div>
                <span className="font-bold text-lg text-[var(--foreground)]">ProxyHub</span>
              </div>

              <div className="flex items-center gap-8 text-sm font-medium text-[var(--text-secondary)]">
                <a href="#" className="hover:text-[var(--primary)] transition-colors">Terms</a>
                <a href="#" className="hover:text-[var(--primary)] transition-colors">Privacy</a>
                <a href="#" className="hover:text-[var(--primary)] transition-colors">Contact</a>
                <a href="#" className="hover:text-[var(--primary)] transition-colors">Community</a>
              </div>

              <div className="text-sm text-[var(--text-muted)]">
                © 2026 ProxyHub. All rights reserved.
              </div>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}

