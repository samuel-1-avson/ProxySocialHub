"use client";
import { Suspense, type ReactNode } from "react";
import { Sidebar } from "@/components/Sidebar";
import { MobileTabBar } from "@/components/MobileTabBar";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { WalletBoundary } from "@/providers/WalletBoundary";
import { RealtimeProvider } from "@/lib/websocket";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
interface AppShellProps {
  children: ReactNode;
  showDesktopActions?: boolean;
  showBreadcrumbs?: boolean;
  showMobileTabBar?: boolean;
  maxWidthClassName?: string;
  contentClassName?: string;
  /** Informational and messaging surfaces do not need chain providers. */
  withWallet?: boolean;
}
export function AppShell({
  children,
  showMobileTabBar = true,
  maxWidthClassName = "max-w-[1400px]",
  contentClassName = "",
  withWallet = true,
}: AppShellProps) {
  return (
    <RealtimeProvider>
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
                {withWallet ? (
                  <WalletBoundary>{children}</WalletBoundary>
                ) : (
                  children
                )}
              </Suspense>
            </ErrorBoundary>
          </main>
        </div>
        {showMobileTabBar && <MobileTabBar />}
      </div>
    </RealtimeProvider>
  );
}
