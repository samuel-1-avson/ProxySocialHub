import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/navigation/routes";

export default function DashboardSecurityRedirectPage() {
  redirect(ROUTES.dashboardSettingsSecurity);
}
