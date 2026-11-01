import Link from "next/link";
import {
  FOOTER_LEGAL_LINKS,
  FOOTER_PLATFORM_LINKS,
  FOOTER_SUPPORT_LINKS,
} from "@/lib/navigation/routes";

export function MarketingFooter() {
  return (
    <footer className="landing-footer">
      <div className="landing-footer-grid">
        <div className="landing-footer-brand">
          <Link href="/" className="marketing-brand">
            <span className="marketing-brand-mark" aria-hidden="true">
              PH
            </span>
            <span className="marketing-brand-name">ProxyHubb</span>
          </Link>
          <p>Proxy infrastructure, with a clear line from offer to usage.</p>
        </div>
        {[
          { label: "Platform", links: FOOTER_PLATFORM_LINKS },
          { label: "Support", links: FOOTER_SUPPORT_LINKS },
          { label: "Legal", links: FOOTER_LEGAL_LINKS },
        ].map((group) => (
          <div key={group.label}>
            <h3>{group.label}</h3>
            <ul>
              {group.links.map((item) => (
                <li key={item.href}>
                  <Link href={item.href}>{item.label}</Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="landing-footer-bottom">
        <span>© {new Date().getFullYear()} ProxyHubb</span>
        <Link href="/help">Help & support</Link>
      </div>
    </footer>
  );
}
