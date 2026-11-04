import type { Metadata } from "next";
import { HubbieEntry } from "@/components/assistant/HubbieEntry";

export const metadata: Metadata = {
  title: "Hubbie · Your personal assistant",
  description: "Your personal ProxyHubb assistant for listings, orders, connections, and provider nodes.",
};

export default function AssistantPage() {
  return <HubbieEntry />;
}
