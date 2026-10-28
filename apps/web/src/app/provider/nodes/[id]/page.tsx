import { SellerNodeDetail } from "@/modules/workspace/SellerNodes";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SellerNodeDetail nodeId={id} />;
}
