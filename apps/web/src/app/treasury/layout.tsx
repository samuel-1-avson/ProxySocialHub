"use client";

import { AppShell } from "@/components/AppShell";
import { ComingSoonBanner } from "@/components/ComingSoonBanner";

export default function TreasuryLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <AppShell showDesktopActions={false} showBreadcrumbs={false} contentClassName="animate-in fade-in duration-500">
            <ComingSoonBanner feature="The treasury" />
            {children}
        </AppShell>
    );
}
