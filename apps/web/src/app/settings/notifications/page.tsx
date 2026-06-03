import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/navigation/routes";

export default function LegacyNotificationsSettingsRedirect() {
    redirect(ROUTES.dashboardSettingsNotifications);
}
