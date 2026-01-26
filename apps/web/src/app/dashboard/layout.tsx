"use client";

import { Sidebar } from "@/components/Sidebar";
import { Navbar } from "@/components/Navbar";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useUIStore } from "@/lib/store/ui-store";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { AlertCenter } from "@/components/AlertCenter";
import { ModeToggle } from "@/components/ModeToggle";

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const { isSidebarCollapsed } = useUIStore();

    return (
        <div className="min-h-screen bg-background text-foreground relative">
            {/* Desktop Top-Right Actions */}
            <div className="hidden md:flex fixed top-6 right-8 z-[100] items-center gap-4 animate-in fade-in slide-in-from-top-2 duration-500">
                <AlertCenter />
                <ModeToggle />
            </div>
            {/* Mobile Navbar (visible only on small screens) */}
            <div className="md:hidden">
                <Navbar showAuth={true} />
            </div>

            {/* Desktop Sidebar */}
            <Sidebar />

            {/* Main Content Area */}
            <main className={`min-h-screen transition-all duration-300 ease-in-out ${isSidebarCollapsed ? "md:pl-20" : "md:pl-64"}`}>
                <div className="container mx-auto p-4 md:p-8 max-w-7xl">
                    <Breadcrumbs />
                    <ErrorBoundary level="section">
                        {children}
                    </ErrorBoundary>
                </div>
            </main>
        </div>
    );
}

