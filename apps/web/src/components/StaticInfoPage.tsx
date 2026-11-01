import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { ROUTES } from "@/lib/navigation/routes";

interface StaticInfoPageProps {
  eyebrow: string;
  title: string;
  summary: string;
  sections: Array<{ title: string; body: string }>;
  links?: Array<{ href: string; label: string; secondary?: boolean }>;
}

function LinkedBody({ text }: { text: string }) {
  return (
    <>
      {text.split(/(https?:\/\/[^\s]+)/g).map((part, index) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={index}
            className="ui-link"
            href={part}
            target="_blank"
            rel="noopener noreferrer"
          >
            {part}
            <ArrowUpRight
              size={11}
              aria-hidden="true"
              className="inline ml-1"
            />
          </a>
        ) : (
          part
        ),
      )}
    </>
  );
}

export function StaticInfoPage({
  eyebrow,
  title,
  summary,
  sections,
  links,
}: StaticInfoPageProps) {
  const actions = links ?? [
    { href: ROUTES.marketplace, label: "Browse marketplace" },
    { href: ROUTES.contact, label: "Contact support", secondary: true },
  ];
  return (
    <div className="public-info-page">
      <MarketingHeader />
      <main id="main-content" tabIndex={-1} className="public-reading">
        <header className="public-reading-header">
          <p className="landing-section-kicker">{eyebrow} / ProxyHubb</p>
          <h1>{title}</h1>
          <p>{summary}</p>
        </header>
        <div className="public-reading-layout">
          <aside className="public-reading-index">
            <p className="ui-eyebrow">On this page</p>
            <nav aria-label="Page contents">
              {sections.map((section, index) => (
                <a key={section.title} href={"#info-section-" + index}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  {section.title}
                </a>
              ))}
            </nav>
            <Link href="/help/contact" className="public-reading-support">
              Need a hand?
              <span>
                Contact support <ArrowRight size={13} aria-hidden="true" />
              </span>
            </Link>
          </aside>
          <div className="public-reading-content">
            {sections.map((section, index) => (
              <section id={"info-section-" + index} key={section.title}>
                <span className="public-section-index">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <h2>{section.title}</h2>
                  <p>
                    <LinkedBody text={section.body} />
                  </p>
                </div>
              </section>
            ))}
            <div className="public-reading-actions">
              {actions.map((action) => (
                <Link
                  key={action.href}
                  href={action.href}
                  className={
                    "ui-button" + (action.secondary ? " secondary" : "")
                  }
                >
                  {action.label}
                  <ArrowRight size={14} aria-hidden="true" />
                </Link>
              ))}
            </div>
          </div>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}
