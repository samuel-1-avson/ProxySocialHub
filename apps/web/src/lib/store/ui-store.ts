import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UIState {
  isSidebarCollapsed: boolean;
  sidebarMobileOpen: boolean;
  compactMode: boolean;
  animationsEnabled: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setSidebarMobileOpen: (open: boolean) => void;
  setCompactMode: (compact: boolean) => void;
  setAnimationsEnabled: (enabled: boolean) => void;
}

/**
 * Single UI preference store (reconstruction plan §5 C-07 / §24.1).
 * Replaces the orphaned `stores/useUIStore.ts`.
 */
export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      isSidebarCollapsed: false,
      sidebarMobileOpen: false,
      compactMode: false,
      animationsEnabled: true,
      toggleSidebar: () =>
        set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed })),
      setSidebarCollapsed: (collapsed) => set({ isSidebarCollapsed: collapsed }),
      setSidebarMobileOpen: (open) => set({ sidebarMobileOpen: open }),
      setCompactMode: (compact) => set({ compactMode: compact }),
      setAnimationsEnabled: (enabled) => set({ animationsEnabled: enabled }),
    }),
    {
      name: 'ui-storage',
      partialize: (state) => ({
        isSidebarCollapsed: state.isSidebarCollapsed,
        compactMode: state.compactMode,
        animationsEnabled: state.animationsEnabled,
      }),
    }
  )
);
