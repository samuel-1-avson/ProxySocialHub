import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen" style={{ background: 'var(--background)' }}>
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-md border-b" style={{ borderColor: 'var(--card-border)' }}>
        <div className="container flex items-center justify-between py-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--primary)' }}>
              <span className="text-white font-bold text-sm">PS</span>
            </div>
            <span className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>
              ProxySocialHub
            </span>
          </Link>

          <div className="flex items-center gap-4">
            <Link href="/login" className="btn btn-ghost">
              Log In
            </Link>
            <Link href="/register" className="btn btn-primary">
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="pt-20">
        <section className="container py-24 text-center">
          {/* Badge */}
          <div className="badge mb-6 mx-auto">
            <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--primary)' }}></span>
            Ghana&apos;s Social Proxy Marketplace
          </div>

          {/* Headline */}
          <h1 className="text-5xl md:text-6xl font-bold mb-6 max-w-3xl mx-auto" style={{ color: 'var(--foreground)' }}>
            Buy. Sell. Connect.
            <br />
            <span style={{ color: 'var(--primary)' }}>Proxies Made Social.</span>
          </h1>

          <p className="text-lg max-w-2xl mx-auto mb-10" style={{ color: 'var(--muted)' }}>
            Join the first social marketplace for proxy bandwidth.
            Follow trusted providers, trade bandwidth, and earn from your connection.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-16">
            <Link href="/register?role=buyer" className="btn btn-primary px-8 py-3 text-lg">
              Browse Marketplace
            </Link>
            <Link href="/register?role=provider" className="btn btn-secondary px-8 py-3 text-lg">
              Start Selling
            </Link>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 max-w-2xl mx-auto">
            {[
              { value: "99.9%", label: "Uptime" },
              { value: "<50ms", label: "Latency" },
              { value: "100%", label: "Residential" },
              { value: "₵0.50", label: "Per GB" },
            ].map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>{stat.value}</div>
                <div className="text-sm" style={{ color: 'var(--muted)' }}>{stat.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Features Section */}
        <section className="py-20" style={{ background: 'var(--card)' }}>
          <div className="container">
            <h2 className="text-3xl font-bold text-center mb-4" style={{ color: 'var(--foreground)' }}>
              Why ProxySocialHub?
            </h2>
            <p className="text-center mb-12 max-w-lg mx-auto" style={{ color: 'var(--muted)' }}>
              A new way to buy and sell proxy bandwidth
            </p>

            <div className="grid md:grid-cols-3 gap-6">
              {/* Feature 1 */}
              <div className="card">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-4" style={{ background: 'rgba(249, 115, 22, 0.1)' }}>
                  <svg className="w-5 h-5" style={{ color: 'var(--primary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--foreground)' }}>
                  Social Marketplace
                </h3>
                <p style={{ color: 'var(--muted)' }}>
                  Follow providers, read reviews, and connect with the community before you buy.
                </p>
              </div>

              {/* Feature 2 */}
              <div className="card">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-4" style={{ background: 'rgba(34, 197, 94, 0.1)' }}>
                  <svg className="w-5 h-5" style={{ color: 'var(--success)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--foreground)' }}>
                  Verified Providers
                </h3>
                <p style={{ color: 'var(--muted)' }}>
                  All providers complete KYC verification. Ratings and reviews you can trust.
                </p>
              </div>

              {/* Feature 3 */}
              <div className="card">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-4" style={{ background: 'rgba(59, 130, 246, 0.1)' }}>
                  <svg className="w-5 h-5" style={{ color: 'var(--info)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--foreground)' }}>
                  MoMo Payments
                </h3>
                <p style={{ color: 'var(--muted)' }}>
                  Pay with MTN, Vodafone, or AirtelTigo mobile money. Instant transactions.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section className="container py-20">
          <h2 className="text-3xl font-bold text-center mb-12" style={{ color: 'var(--foreground)' }}>
            How It Works
          </h2>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              { step: "01", title: "Browse Providers", desc: "Explore listings from verified Ghana proxy providers." },
              { step: "02", title: "Choose & Purchase", desc: "Select bandwidth, pay with MoMo, get instant access." },
              { step: "03", title: "Rate & Review", desc: "Share your experience and help the community." },
            ].map((item) => (
              <div key={item.step} className="text-center">
                <div className="text-4xl font-bold mb-4" style={{ color: 'var(--primary)' }}>{item.step}</div>
                <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--foreground)' }}>{item.title}</h3>
                <p style={{ color: 'var(--muted)' }}>{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Provider CTA */}
        <section className="py-20" style={{ background: 'var(--card)' }}>
          <div className="container">
            <div className="grid md:grid-cols-2 gap-12 items-center">
              <div>
                <div className="badge badge-success mb-4">For Providers</div>
                <h2 className="text-3xl font-bold mb-6" style={{ color: 'var(--foreground)' }}>
                  Earn From Your Internet Connection
                </h2>
                <p className="mb-6" style={{ color: 'var(--muted)' }}>
                  Share your unused bandwidth and earn daily payouts directly to your mobile money.
                  Safe, secure, and completely passive income.
                </p>
                <ul className="space-y-3 mb-8">
                  {[
                    "Earn GHS 0.20 per GB shared",
                    "Daily payouts via MoMo",
                    "Build your reputation & followers",
                    "Set your own prices",
                  ].map((item) => (
                    <li key={item} className="flex items-center gap-3" style={{ color: 'var(--foreground)' }}>
                      <svg className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--success)' }} fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      {item}
                    </li>
                  ))}
                </ul>
                <Link href="/register?role=provider" className="btn btn-primary">
                  Start Earning Today
                </Link>
              </div>
              <div className="card text-center py-12">
                <div className="text-5xl font-bold mb-2" style={{ color: 'var(--primary)' }}>
                  GHS 200+
                </div>
                <p style={{ color: 'var(--muted)' }}>Average monthly earnings</p>
              </div>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="py-12 border-t" style={{ borderColor: 'var(--card-border)' }}>
          <div className="container">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded flex items-center justify-center" style={{ background: 'var(--primary)' }}>
                  <span className="text-white font-bold text-xs">PS</span>
                </div>
                <span className="font-semibold" style={{ color: 'var(--foreground)' }}>ProxySocialHub</span>
              </div>
              <div className="flex items-center gap-6 text-sm" style={{ color: 'var(--muted)' }}>
                <a href="#" className="hover:underline">Terms</a>
                <a href="#" className="hover:underline">Privacy</a>
                <a href="#" className="hover:underline">Contact</a>
              </div>
              <div className="text-sm" style={{ color: 'var(--muted)' }}>
                © 2026 ProxySocialHub. All rights reserved.
              </div>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
