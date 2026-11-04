import type { Metadata } from "next";
import HubbieAssistant from "@/components/assistant/HubbieAssistant";
import "@/components/assistant/assistant.css";

export const metadata: Metadata = {
  title: "Hubbie · Your personal assistant",
  description: "Your personal ProxyHubb assistant for listings, orders, connections, and provider nodes.",
};

export default function AssistantPage() {
  return (
    <div className="hubbie-page">
      <header className="hubbie-page-heading">
        <p className="ui-eyebrow">Your workspace / Personal assistant</p>
        <h1>Meet Hubbie.</h1>
        <p>A little guidance. A clearer next step. Your ProxyHubb account, with a helping hand.</p>
      </header>
      <HubbieAssistant />
    </div>
  );
}
