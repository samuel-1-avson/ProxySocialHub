"use client";

import { Sidebar } from "@/components/Sidebar";
import { Navbar } from "@/components/Navbar";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useUIStore } from "@/lib/store/ui-store";
import { Breadcrumbs } from "@/components/Breadcrumbs";

export default function ExplorerLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const { isSidebarCollapsed } = useUIStore();

    return (
        <div className="min-h-screen bg-background text-foreground selection:bg-primary/30 font-mono">
            {/* Mobile Navbar */}
            <div className="md:hidden">
                <Navbar showAuth={true} />
            </div>

            {/* Desktop Sidebar */}
            <Sidebar />

            {/* Main Content Area */}
            <main className={`min-h-screen transition-all duration-300 ease-in-out ${isSidebarCollapsed ? "md:pl-20" : "md:pl-64"}`}>
                <div className="container mx-auto p-4 md:p-8 max-w-7xl pt-24">
                    <Breadcrumbs />
                    <ErrorBoundary level="section">
                        {children}
                    </ErrorBoundary>
                </div>
            </main>
        </div>
    );
}
