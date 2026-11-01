"use client";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { withAuth } from "@/components/ProtectedRoute";
function SellerLayout({ children }: { children: ReactNode }) {
  const path = usePathname();
  return <AppShell withWallet={path === "/provider/listings/new"}>{children}</AppShell>;
}
export default withAuth(SellerLayout, "provider");
