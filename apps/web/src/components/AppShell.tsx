"use client";

import { ReactNode } from "react";
import { Sidebar } from "@/components/Sidebar";
import { Navbar } from "@/components/Navbar";
import { MobileTabBar } from "@/components/MobileTabBar";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { AlertCenter } from "@/components/AlertCenter";
import { ModeToggle } from "@/components/ModeToggle";
import { useUIStore } from "@/lib/store/ui-store";
import { WalletBoundary } from "@/providers/WalletBoundary";
import { RealtimeProvider } from "@/lib/websocket";
import { LinkedWalletAutoReconnect } from "@/components/LinkedWalletAutoReconnect";

interface AppShellProps {
  children: ReactNode;
  showDesktopActions?: boolean;
  showBreadcrumbs?: boolean;
  showMobileTabBar?: boolean;
  maxWidthClassName?: string;
  contentClassName?: string;
}

export function AppShell({
  children,
  showDesktopActions = true,
  showBreadcrumbs = true,
  showMobileTabBar = true,
  maxWidthClassName = "max-w-7xl",
  contentClassName = "",
}: AppShellProps) {
  const { isSidebarCollapsed } = useUIStore();

  return (
    <WalletBoundary>
      <RealtimeProvider>
        <LinkedWalletAutoReconnect />
        <div className="min-h-screen bg-background text-foreground relative">
          {showDesktopActions && (
            <div className="hidden md:flex fixed top-6 right-8 z-[100] items-center gap-4">
              <AlertCenter />
              <ModeToggle />
            </div>
          )}

          <div className="md:hidden">
            <Navbar showAuth={true} />
          </div>

          <Sidebar />

          <main
            className={`min-h-screen transition-[padding] duration-[var(--dur-med)] ease-[var(--ease-out)] pb-20 md:pb-0 ${
              isSidebarCollapsed ? "md:pl-20" : "md:pl-64"
            }`}
          >
            <div
              className={`container mx-auto p-4 md:p-8 ${maxWidthClassName} ${contentClassName}`}
            >
              {showBreadcrumbs && <Breadcrumbs />}
              <ErrorBoundary level="section">{children}</ErrorBoundary>
            </div>
          </main>

          {showMobileTabBar && <MobileTabBar />}
        </div>
      </RealtimeProvider>
    </WalletBoundary>
  );
}
