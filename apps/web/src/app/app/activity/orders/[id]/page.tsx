import { MarketplaceOrderDetailView } from "@/components/marketplace/MarketplaceOrderDetailView";
export default async function OrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <MarketplaceOrderDetailView
      orderId={id}
      backHref="/app/activity"
      backLabel="Activity"
    />
  );
}
