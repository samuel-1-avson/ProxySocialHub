import { MarketplaceOrderDetailView } from "@/components/marketplace/MarketplaceOrderDetailView";
export default async function ConnectionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <MarketplaceOrderDetailView
      orderId={id}
      backHref="/app/connections"
      backLabel="Connections"
    />
  );
}
