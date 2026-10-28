"use client";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { withAuth } from "@/components/ProtectedRoute";
function SellerLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
export default withAuth(SellerLayout, "provider");
