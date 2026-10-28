"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PageHeading } from "@/components/workspace/Patterns";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="ui-page">
      <PageHeading title="Advanced account settings" eyebrow="Account utility" description="Account entitlements, data controls, and developer credentials." />
      <nav className="ui-tabs" aria-label="Account tools">
        <Link href="/app/settings">Profile & security</Link>
        {[["/dashboard/settings/account", "Account & data"], ["/dashboard/settings/api-keys", "API keys"]].map(([href, label]) => (
          <Link key={href} href={href} className={pathname === href ? "active" : ""} aria-current={pathname === href ? "page" : undefined}>{label}</Link>
        ))}
      </nav>
      <section className="min-w-0">{children}</section>
    </div>
  );
}
