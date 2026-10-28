"use client";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { isRoleAllowedForPolicy } from "@/lib/navigation/policies";
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
  const requested =
    workspaceForPath(pathname) ??
    (user?.role === "provider" ? "seller" : preference);
  return {
    mode: canSell ? requested : ("buyer" as const),
    canSell,
    setPreferredWorkspace,
  };
}
