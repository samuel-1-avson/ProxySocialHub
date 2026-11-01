import type { Metadata } from "next";
import { StaticInfoPage } from "@/components/StaticInfoPage";

export const metadata: Metadata = {
  title: "Community Guidelines",
  description:
    "ProxyHubb community spaces are for useful network, provider, buyer, and marketplace collaboration.",
};

export default function GuidelinesPage() {
  return (
    <StaticInfoPage
      eyebrow="Community"
      title="Community Guidelines"
      summary="ProxyHubb community spaces are for useful network, provider, buyer, and marketplace collaboration."
      sections={[
        {
          title: "Be clear and professional",
          body: "Keep posts, messages, reviews, and provider responses focused on the issue, service quality, or technical detail being discussed.",
        },
        {
          title: "Do not manipulate trust signals",
          body: "Do not create fake reviews, coordinated saves, misleading listings, or artificial marketplace activity.",
        },
        {
          title: "Protect users and infrastructure",
          body: "Do not share private credentials, exploit instructions, private keys, payment secrets, or data that exposes another user or node operator.",
        },
      ]}
    />
  );
}
