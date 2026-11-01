"use client";

import { usePathname } from "next/navigation";
import { AppShell } from "@/components/AppShell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <AppShell
      withWallet={path === "/marketplace/create"}
      showDesktopActions={false}
      showBreadcrumbs={false}
      contentClassName="animate-in fade-in duration-500"
    >
      {children}
    </AppShell>
  );
}
