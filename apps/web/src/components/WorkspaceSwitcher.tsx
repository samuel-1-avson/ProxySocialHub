"use client";
import { useRouter } from "next/navigation";
import { ArrowLeftRight } from "lucide-react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { ROUTES } from "@/lib/navigation/routes";
import type { WorkspaceMode } from "@/lib/store/workspace-store";
export function WorkspaceSwitcher({
  isCollapsed = false,
  onSwitch,
}: {
  isCollapsed?: boolean;
  onSwitch?: () => void;
}) {
  const router = useRouter();
  const { selected, canSell, setPreferredWorkspace } = useWorkspace();
  return (
    <label className="workspace-switcher">
      <ArrowLeftRight size={16} aria-hidden="true" />
      <span className="sr-only">Workspace</span>
      <select
        aria-label="Workspace"
        title={isCollapsed ? "Workspace" : undefined}
        value={selected}
        onChange={(event) => {
          const next = event.target.value;
          onSwitch?.();
          if (next === "apply") {
            router.push(ROUTES.dashboardBecomeProvider);
            return;
          }
          setPreferredWorkspace(next as WorkspaceMode);
          router.push(next === "seller" ? ROUTES.seller : ROUTES.workspace);
        }}
      >
        <option value="buyer">Buyer workspace</option>
        {canSell ? (
          <option value="seller">Provider workspace</option>
        ) : (
          <option value="apply">
            {selected === "apply" ? "Become a provider" : "Become a provider…"}
          </option>
        )}
      </select>
    </label>
  );
}
