"use client";

import { AppShell } from "@/components/AppShell";
import { withAuth } from "@/components/ProtectedRoute";

function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return <AppShell>{children}</AppShell>;
}

export default withAuth(DashboardLayout);

