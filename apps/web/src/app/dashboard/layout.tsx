"use client";

import { usePathname } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { withAuth } from "@/components/ProtectedRoute";

function DashboardLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <AppShell withWallet={path === "/dashboard/proxy" || path === "/dashboard/trustless"}>
      <div className="record-family">{children}</div>
    </AppShell>
  );
}

export default withAuth(DashboardLayout);
