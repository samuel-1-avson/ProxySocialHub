"use client";

import { AppShell } from "@/components/AppShell";

export default function ProfileLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <AppShell withWallet={false} showDesktopActions={false} showBreadcrumbs={false} contentClassName="animate-in fade-in duration-500">
            {children}
        </AppShell>
    );
}
