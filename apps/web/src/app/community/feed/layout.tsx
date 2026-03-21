"use client";

import { Sidebar } from "@/components/Sidebar";
import { Navbar } from "@/components/Navbar";

export default function FeedLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <div className="min-h-screen bg-background text-foreground">
            <div className="md:hidden">
                <Navbar showAuth={true} />
            </div>
            <Sidebar />
            <main className="md:pl-64 min-h-screen transition-all">
                <div className="container mx-auto p-4 md:p-8 max-w-7xl animate-in fade-in duration-500">
                    {children}
                </div>
            </main>
        </div>
    );
}
