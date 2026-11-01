"use client";

import { usePathname } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ComingSoonBanner } from "@/components/ComingSoonBanner";

export default function GovernanceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const path = usePathname();
  return (
    <AppShell
      withWallet={path !== "/governance"}
      showDesktopActions={false}
      showBreadcrumbs={false}
      contentClassName="animate-in fade-in duration-500"
    >
      <ComingSoonBanner feature="Governance" />
      {children}
    </AppShell>
  );
}
