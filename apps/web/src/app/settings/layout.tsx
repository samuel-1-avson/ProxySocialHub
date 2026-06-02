"use client";

import { AppShell } from "@/components/AppShell";
import { withAuth } from "@/components/ProtectedRoute";

function SettingsLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return <AppShell>{children}</AppShell>;
}

export default withAuth(SettingsLayout);
