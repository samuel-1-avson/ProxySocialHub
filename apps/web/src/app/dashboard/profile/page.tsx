import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/navigation/routes";

export default function DashboardProfileRedirectPage() {
  redirect(ROUTES.dashboardSettingsIdentity);
}
