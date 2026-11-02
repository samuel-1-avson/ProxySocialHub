"use client";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { withAuth } from "@/components/ProtectedRoute";
function SellerLayout({ children }: { children: ReactNode }) {
  // Seller surfaces sign listing offers/edits with the browser wallet, not
  // only on the new-listing page. Mount the wallet provider shell-wide.
  return <AppShell withWallet>{children}</AppShell>;
}
export default withAuth(SellerLayout, "provider");
