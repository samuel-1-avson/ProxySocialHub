"use client";

import { AppShell } from "@/components/AppShell";
import { withAuth } from "@/components/ProtectedRoute";

function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Authenticated shell: dashboard surfaces include wallet signing (proxy,
  // trustless, wallet tools). Mount the wallet provider for the whole shell
  // instead of an allowlist that silently strands new signing pages.
  return (
    <AppShell withWallet>
      <div className="record-family">{children}</div>
    </AppShell>
  );
}

export default withAuth(DashboardLayout);
