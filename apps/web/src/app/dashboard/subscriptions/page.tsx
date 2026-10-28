import { redirect } from "next/navigation";
export default function Page() {
  redirect("/app/activity?tab=billing");
}
