import { redirect } from "next/navigation";

/** Audits live inside Connections; this address is kept so existing links and bookmarks still land there. */
export default function Page() {
  redirect("/app/connections?tab=audits");
}
