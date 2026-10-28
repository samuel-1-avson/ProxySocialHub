import { redirect } from "next/navigation";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const search = new URLSearchParams();
  for (const key of ["page", "submitted"])
    if (typeof params[key] === "string") search.set(key, params[key]);
  redirect(`/provider/listings${search.size ? `?${search}` : ""}`);
}
