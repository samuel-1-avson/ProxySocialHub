"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { Navbar } from "@/components/Navbar";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useUIStore } from "@/lib/store/ui-store";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MobileTabBar } from "@/components/MobileTabBar";
import { ExplorerTrustBadge } from "@/components/explorer/ExplorerTrustBadge";
import { getVisibleExplorerTabs } from "@/lib/navigation/explorer-nav";

export default function ExplorerLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const { isSidebarCollapsed } = useUIStore();
    const pathname = usePathname();
    const explorerTabs = getVisibleExplorerTabs();

    return (
        <div className="min-h-screen bg-background text-foreground font-sans">
            {/* Mobile Navbar */}
            <div className="md:hidden">
                <Navbar showAuth={true} />
            </div>

            {/* Desktop Sidebar */}
            <Sidebar />

            {/* Main Content Area */}
            <main className={`min-h-screen transition-all duration-300 ease-in-out ${isSidebarCollapsed ? "md:pl-20" : "md:pl-64"}`}>
                
                {/* Explorer Sub-navigation Header */}
                <div className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-white/5 px-4 md:px-8 py-4 mt-16 md:mt-0">
                    <div className="mb-4 flex items-center justify-between gap-4">
                        <h1 className="text-2xl font-bold font-sans tracking-tight">Network Explorer</h1>
                        <ExplorerTrustBadge className="shrink-0" />
                    </div>
                    <div className="flex overflow-x-auto gap-2 pb-2 scrollbar-none snap-x mask-fade-edges">
                        {explorerTabs.map((tab) => {
                            const isOverview = tab.id === "overview";
                            const isActive = isOverview
                                ? pathname === tab.href || pathname === `${tab.href}/`
                                : pathname === tab.href || pathname?.startsWith(`${tab.href}/`);
                            return (
                                <Link
                                    key={tab.id}
                                    href={tab.href}
                                    prefetch={false}
                                    className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap snap-start transition-all ${
                                        isActive
                                            ? "bg-primary text-primary-foreground shadow-[0_0_15px_rgba(16,185,129,0.3)]"
                                            : "bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-white"
                                    }`}
                                >
                                    {tab.label}
                                </Link>
                            );
                        })}
                    </div>
                </div>

                <div className="container mx-auto p-4 md:p-8 max-w-7xl">
                    <Breadcrumbs />
                    <ErrorBoundary level="section">
                        {children}
                    </ErrorBoundary>
                </div>
            </main>
            
            {/* Mobile Bottom Tab Bar */}
            <MobileTabBar />
        </div>
    );
}
