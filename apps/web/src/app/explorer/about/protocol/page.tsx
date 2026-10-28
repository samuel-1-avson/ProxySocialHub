import type { Metadata } from "next";
import { DePINPortal } from "@/components/network/DePINPortal";

export const metadata: Metadata = {
  title: "Protocol overview | ProxyHubb",
  description:
    "Explore supported ProxyHubb workspaces, public network evidence, and the current settlement acceptance status.",
};

export default function ProtocolOverviewPage() {
  return <DePINPortal />;
}
