/**
 * UI Store
 * Global state for UI preferences and sidebar state
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UIState {
    // Sidebar
    sidebarCollapsed: boolean;
    sidebarMobileOpen: boolean;

    // Theme preferences (beyond next-themes)
    compactMode: boolean;
    animationsEnabled: boolean;

    // Actions
    toggleSidebar: () => void;
    setSidebarCollapsed: (collapsed: boolean) => void;
    setSidebarMobileOpen: (open: boolean) => void;
    setCompactMode: (compact: boolean) => void;
    setAnimationsEnabled: (enabled: boolean) => void;
}

export const useUIStore = create<UIState>()(
    persist(
        (set) => ({
            // Initial state
            sidebarCollapsed: false,
            sidebarMobileOpen: false,
            compactMode: false,
            animationsEnabled: true,

            // Actions
            toggleSidebar: () => set((state) => ({
                sidebarCollapsed: !state.sidebarCollapsed
            })),

            setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

            setSidebarMobileOpen: (open) => set({ sidebarMobileOpen: open }),

            setCompactMode: (compact) => set({ compactMode: compact }),

            setAnimationsEnabled: (enabled) => set({ animationsEnabled: enabled }),
        }),
        {
            name: 'proxyhubb-ui-store',
            partialize: (state) => ({
                sidebarCollapsed: state.sidebarCollapsed,
                compactMode: state.compactMode,
                animationsEnabled: state.animationsEnabled,
            }),
        }
    )
);
