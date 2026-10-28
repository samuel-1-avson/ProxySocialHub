import Link from "next/link";

const explorerHref = process.env.NEXT_PUBLIC_EXPLORER_URL || "/explorer";

const destinations = [
  {
    eyebrow: "Buyer workspace",
    title: "Browse proxy capacity",
    description:
      "Review provider offers, compare the reported listing details, and follow the purchase flow from the marketplace.",
    href: "/marketplace",
    label: "Browse marketplace",
  },
  {
    eyebrow: "Seller workspace",
    title: "Manage provider supply",
    description:
      "Register a node, configure its connection, publish an offer, and review recorded earnings from the provider workspace.",
    href: "/provider",
    label: "Open seller workspace",
  },
  {
    eyebrow: "Public evidence",
    title: "Inspect network records",
    description:
      "Review the public node inventory, source health, indexed transactions, and governance records without signing in.",
    href: explorerHref,
    label: "Open Explorer",
  },
];

export function DePINPortal() {
  return (
    <main className="min-h-screen bg-background px-4 py-12 text-foreground sm:px-6 lg:py-16">
      <div className="mx-auto w-full max-w-6xl">
        <header className="max-w-3xl">
          <p className="mb-3 text-sm font-medium text-muted-foreground">
            Protocol overview
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">
            A clear view of what ProxyHubb supports today.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
            ProxyHubb connects buyers with provider capacity through a shared
            marketplace. Use the workspaces for supported operations and the
            Explorer for public network evidence.
          </p>
        </header>

        <aside
          className="mt-9 rounded-xl border border-border bg-card p-5 sm:p-6"
          aria-labelledby="status-title"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 id="status-title" className="text-base font-semibold">
                Settlement status
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                The frontend shows order, traffic, and earnings states from
                their connected sources. A complete funded-purchase to verified
                traffic to accepted earnings run has not yet been confirmed
                end-to-end.
              </p>
            </div>
            <span className="w-fit shrink-0 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground">
              Acceptance pending
            </span>
          </div>
        </aside>

        <section className="mt-12" aria-labelledby="destinations-title">
          <div className="mb-5">
            <p className="text-sm font-medium text-muted-foreground">
              Continue to a workspace
            </p>
            <h2
              id="destinations-title"
              className="mt-1 text-xl font-semibold tracking-tight"
            >
              The product, organized by task
            </h2>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {destinations.map((destination) => (
              <article
                key={destination.href}
                className="flex min-h-56 flex-col rounded-xl border border-border bg-card p-5 sm:p-6"
              >
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {destination.eyebrow}
                </p>
                <h3 className="mt-3 text-lg font-semibold">
                  {destination.title}
                </h3>
                <p className="mt-2 flex-1 text-sm leading-6 text-muted-foreground">
                  {destination.description}
                </p>
                <Link
                  href={destination.href}
                  className="mt-5 inline-flex min-h-10 w-fit items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {destination.label} <span aria-hidden="true" className="ml-2">→</span>
                </Link>
              </article>
            ))}
          </div>
        </section>

        <section
          className="mt-10 rounded-xl border border-border bg-muted/30 p-5 sm:p-6"
          aria-labelledby="not-available-title"
        >
          <h2 id="not-available-title" className="text-base font-semibold">
            Features not offered on this page
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Staking, mining rewards, reward claims, and cryptographic receipt
            demonstrations are not enabled here. This page does not simulate
            balances, submit transactions, or create success receipts. Only
            actions shown in the authenticated workspace can initiate a
            supported operation.
          </p>
        </section>

        <footer className="mt-8 border-t border-border pt-5 text-sm text-muted-foreground">
          <Link className="underline underline-offset-4" href="/help">
            Read the help center
          </Link>
          <span aria-hidden="true" className="mx-2">·</span>
          <Link className="underline underline-offset-4" href="/">
            Return to ProxyHubb
          </Link>
        </footer>
      </div>
    </main>
  );
}
