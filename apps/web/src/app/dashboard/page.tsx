"use client";
import { BuyerOverview } from "@/modules/workspace/BuyerOverview";
import { SellerOverview } from "@/modules/workspace/SellerPages";
import { useWorkspace } from "@/hooks/useWorkspace";
export default function DashboardPage() {
  const { mode } = useWorkspace();
  return mode === "seller" ? <SellerOverview /> : <BuyerOverview />;
}
