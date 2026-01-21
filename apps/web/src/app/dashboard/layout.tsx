"use client";

import { Sidebar } from "@/components/Sidebar";
import { Navbar } from "@/components/Navbar";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <div className="min-h-screen bg-background text-foreground">
            {/* Mobile Navbar (visible only on small screens) */}
            <div className="md:hidden">
                <Navbar showAuth={true} />
            </div>

            {/* Desktop Sidebar */}
            <Sidebar />

            {/* Main Content Area */}
            <main className="md:pl-64 min-h-screen transition-all">
                <div className="container mx-auto p-4 md:p-8 max-w-7xl">
                    <ErrorBoundary level="section">
                        {children}
                    </ErrorBoundary>
                </div>
            </main>
        </div>
    );
}

