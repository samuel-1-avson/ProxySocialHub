import { AuditDetail } from "@/modules/audits/AuditDetail";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AuditDetail auditId={id} />;
}
