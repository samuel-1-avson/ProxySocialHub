import { Explorer } from "../Explorer";
import { notFound } from "next/navigation";
export default async function Page({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path } = await params;
  const detailRoots = [
    "nodes",
    "transactions",
    "blocks",
    "wallets",
    "contracts",
    "governance",
  ];
  const listRoots = [...detailRoots, "analytics", "health", "search"];
  if (
    !listRoots.includes(path[0]) ||
    path.length > 2 ||
    (path.length === 2 && !detailRoots.includes(path[0]))
  )
    notFound();
  if (["wallets", "contracts"].includes(path[0]) && path.length === 1)
    notFound();
  return <Explorer path={path} />;
}
