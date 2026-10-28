import { notFound } from "next/navigation";
import { StaticInfoPage } from "@/components/StaticInfoPage";
import { ROUTES } from "@/lib/navigation/routes";

const archiveSections = {
  feed: {
    title: "Community activity",
    summary: "The social activity feed is no longer a primary Property Hub destination.",
    sections: [
      {
        title: "Where to go now",
        body: "Use the marketplace to discover offers, Activity to review your orders, and Messages to continue existing conversations.",
      },
      {
        title: "Your account data",
        body: "This archive page does not change or delete account, order, or conversation records.",
      },
    ],
  },
  beta: {
    title: "Beta program archive",
    summary: "Beta recruitment and task tracking have moved out of the core workspace navigation.",
    sections: [
      {
        title: "Program status",
        body: "This page is informational. It does not accept new beta task submissions or change program status.",
      },
      {
        title: "Product support",
        body: "For current marketplace and account help, visit the Help Center or contact support.",
      },
    ],
  },
} as const;

export default async function CommunityArchivePage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (!Object.hasOwn(archiveSections, section)) notFound();
  const entry = archiveSections[section as keyof typeof archiveSections];

  return (
    <StaticInfoPage
      eyebrow="Community archive"
      title={entry.title}
      summary={entry.summary}
      sections={entry.sections.map((item) => ({
        ...item,
        body: item.body,
      }))}
      links={[
        { href: ROUTES.marketplace, label: "Browse marketplace" },
        { href: ROUTES.help, label: "Help Center" },
      ]}
    />
  );
}
