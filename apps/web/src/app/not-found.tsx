import { PublicStatusPage } from "@/components/marketing/PublicStatusPage";

export default function NotFound() {
  return (
    <PublicStatusPage
      code="404"
      title="Page not found"
      description="The address may have changed or the page may no longer exist. Head back to the marketplace to find your next connection."
      actionHref="/marketplace"
      actionLabel="Browse marketplace"
    />
  );
}
