"use client";

import { AppShell } from "@/components/AppShell";

export default function FeedLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <AppShell showDesktopActions={false} showBreadcrumbs={false} contentClassName="animate-in fade-in duration-500">
            {children}
        </AppShell>
    );
}
