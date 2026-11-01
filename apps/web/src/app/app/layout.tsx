"use client";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { withAuth } from "@/components/ProtectedRoute";
function WorkspaceLayout({ children }: { children: ReactNode }) {
  const path = usePathname();
  return <AppShell withWallet={path === "/app/wallet" || path === "/app/activity"}>{children}</AppShell>;
}
export default withAuth(WorkspaceLayout);
