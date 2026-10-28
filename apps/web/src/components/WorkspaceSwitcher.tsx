"use client";
import { useRouter } from "next/navigation";
import { ArrowLeftRight } from "lucide-react";
import { useWorkspace } from "@/hooks/useWorkspace";
import type { WorkspaceMode } from "@/lib/store/workspace-store";
export function WorkspaceSwitcher({
  isCollapsed = false,
  onSwitch,
}: {
  isCollapsed?: boolean;
  onSwitch?: () => void;
}) {
  const router = useRouter();
  const { mode, canSell, setPreferredWorkspace } = useWorkspace();
  return (
    <label className="workspace-switcher">
      <ArrowLeftRight size={16} aria-hidden="true" />
      <span className="sr-only">Workspace</span>
      <select
        aria-label="Workspace"
        title={isCollapsed ? "Workspace" : undefined}
        value={mode}
        onChange={(event) => {
          const next = event.target.value;
          onSwitch?.();
          if (next === "apply") {
            router.push("/dashboard/become-provider");
            return;
          }
          setPreferredWorkspace(next as WorkspaceMode);
          router.push(next === "seller" ? "/provider" : "/app");
        }}
      >
        <option value="buyer">Buyer workspace</option>
        {canSell ? (
          <option value="seller">Seller workspace</option>
        ) : (
          <option value="apply">Start selling…</option>
        )}
      </select>
    </label>
  );
}
