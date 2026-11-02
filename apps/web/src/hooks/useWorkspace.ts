"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { isRoleAllowedForPolicy } from "@/lib/navigation/policies";
import { ROUTES } from "@/lib/navigation/routes";
import { workspaceForPath } from "@/lib/navigation/workspace";
import { useWorkspaceStore } from "@/lib/store/workspace-store";
export function useWorkspace() {
  const pathname = usePathname();
  const { user } = useAuth();
  const preference = useWorkspaceStore((state) => state.preferredWorkspace);
  const setPreferredWorkspace = useWorkspaceStore(
    (state) => state.setPreferredWorkspace,
  );
  const canSell = isRoleAllowedForPolicy(user?.role, "provider");
  const fromPath = workspaceForPath(pathname);
  // Remember the workspace of the last buyer or provider page, so shared
  // pages (Wallet, Settings) keep showing the one the user is working in.
  useEffect(() => {
    if (canSell && fromPath && fromPath !== preference)
      setPreferredWorkspace(fromPath);
  }, [canSell, fromPath, preference, setPreferredWorkspace]);
  const mode = canSell ? (fromPath ?? preference) : ("buyer" as const);
  const applying =
    !canSell && pathname.startsWith(ROUTES.dashboardBecomeProvider);
  return {
    mode,
    /** What the workspace switcher shows; "apply" on the become-provider page. */
    selected: applying ? ("apply" as const) : mode,
    canSell,
    setPreferredWorkspace,
  };
}
