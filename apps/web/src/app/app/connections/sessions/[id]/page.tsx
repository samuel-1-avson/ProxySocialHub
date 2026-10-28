import { SessionDetail } from "@/modules/workspace/SessionDetail";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SessionDetail sessionId={id} />;
}
