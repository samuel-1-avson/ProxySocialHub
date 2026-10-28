import { redirect } from "next/navigation";
export default function Page() {
  redirect("/provider/earnings?tab=payouts");
}
