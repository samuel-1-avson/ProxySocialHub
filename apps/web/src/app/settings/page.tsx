import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/navigation/routes";

const LEGACY_TAB_DESTINATIONS: Record<string, string> = {
    General: ROUTES.dashboardSettingsIdentity,
    Notifications: ROUTES.dashboardSettingsNotifications,
    Security: ROUTES.dashboardSettingsSecurity,
    Devices: ROUTES.dashboardSettingsDevices,
    general: ROUTES.dashboardSettingsIdentity,
    notifications: ROUTES.dashboardSettingsNotifications,
    security: ROUTES.dashboardSettingsSecurity,
    devices: ROUTES.dashboardSettingsDevices,
    "api-keys": ROUTES.dashboardSettingsApiKeys,
    apikeys: ROUTES.dashboardSettingsApiKeys,
};

type SettingsPageProps = {
    searchParams: Promise<{ tab?: string }>;
};

/** Legacy `/settings` hub — redirects into dashboard settings sub-pages. */
export default async function LegacySettingsRedirectPage({ searchParams }: SettingsPageProps) {
    const params = await searchParams;
    const tab = params.tab?.trim();
    const destination = tab ? LEGACY_TAB_DESTINATIONS[tab] : undefined;
    redirect(destination ?? ROUTES.dashboardSettingsIdentity);
}
