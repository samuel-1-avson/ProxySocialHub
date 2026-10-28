"use client";
import { Suspense, type ReactNode } from "react";
import { Sidebar } from "@/components/Sidebar";
import { MobileTabBar } from "@/components/MobileTabBar";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { WalletBoundary } from "@/providers/WalletBoundary";
import { RealtimeProvider } from "@/lib/websocket";
import { LinkedWalletAutoReconnect } from "@/components/LinkedWalletAutoReconnect";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
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
  showMobileTabBar = true,
  maxWidthClassName = "max-w-7xl",
  contentClassName = "",
}: AppShellProps) {
  return (
    <WalletBoundary>
      <RealtimeProvider>
        <LinkedWalletAutoReconnect />
        <div className="workspace-shell">
          <Sidebar />
          <div className="workspace-main-column">
            <WorkspaceHeader />
            <main
              id="main-content"
              tabIndex={-1}
              className={`workspace-content ${maxWidthClassName} ${contentClassName}`}
            >
              <ErrorBoundary level="section">
                <Suspense
                  fallback={
                    <div className="ui-loading" role="status">
                      Loading workspace…
                    </div>
                  }
                >
                  {children}
                </Suspense>
              </ErrorBoundary>
            </main>
          </div>
          {showMobileTabBar && <MobileTabBar />}
        </div>
      </RealtimeProvider>
    </WalletBoundary>
  );
}
