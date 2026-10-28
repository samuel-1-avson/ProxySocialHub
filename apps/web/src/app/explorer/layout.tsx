import { redirect } from "next/navigation";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

/** The embedded Explorer is retired. Every visit goes to the dedicated site. */
export default function ExplorerLayout({ children }: { children: ReactNode }) {
  void children;
  redirect("https://explorer.proxyhubb.com/");
}
