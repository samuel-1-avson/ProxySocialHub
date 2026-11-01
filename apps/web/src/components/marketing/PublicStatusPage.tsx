import Link from "next/link";
import { ArrowRight, MoveUpRight } from "lucide-react";
import { MarketingHeader } from "./MarketingHeader";
import { MarketingFooter } from "./MarketingFooter";

export function PublicStatusPage({
  code,
  title,
  description,
  actionHref,
  actionLabel,
}: {
  code: string;
  title: string;
  description: string;
  actionHref: string;
  actionLabel: string;
}) {
  return (
    <div className="public-info-page">
      <MarketingHeader />
      <main className="public-status" id="main-content" tabIndex={-1}>
        <div className="public-status-mark" aria-hidden="true">
          {code}
          <MoveUpRight />
        </div>
        <p className="landing-section-kicker">ProxyHubb / {code}</p>
        <h1>{title}</h1>
        <p>{description}</p>
        <div className="public-reading-actions">
          <Link href={actionHref} className="ui-button">
            {actionLabel}
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
          <Link href="/help" className="ui-button secondary">
            Help center
          </Link>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}
