"use client";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { withAuth } from "@/components/ProtectedRoute";
function WorkspaceLayout({ children }: { children: ReactNode }) {
  // The whole authenticated workspace can sign: marketplace buying, seller
  // listing edits, wallet deposits/withdrawals/linking and order recovery
  // all live under /app/*. Allowlisting two paths left the rest on a
  // disconnected default wallet context, so mount the wallet provider for
  // the entire shell (it lazy-loads; see WalletBoundary).
  return <AppShell withWallet>{children}</AppShell>;
}
export default withAuth(WorkspaceLayout);
