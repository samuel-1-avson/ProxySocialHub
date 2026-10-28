import { create } from "zustand";
import { persist } from "zustand/middleware";
export type WorkspaceMode = "buyer" | "seller";
/** Navigation preference only, never an authorization source. */
export const useWorkspaceStore = create<{
  preferredWorkspace: WorkspaceMode;
  setPreferredWorkspace: (mode: WorkspaceMode) => void;
}>()(
  persist(
    (set) => ({
      preferredWorkspace: "buyer",
      setPreferredWorkspace: (preferredWorkspace) =>
        set({ preferredWorkspace }),
    }),
    {
      name: "proxyhubb-workspace",
      partialize: ({ preferredWorkspace }) => ({ preferredWorkspace }),
    },
  ),
);
