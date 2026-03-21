/**
 * Map Theme Definitions
 * Cyberpunk-inspired map styles for different visual modes
 */

export type MapTheme = "dark" | "light" | "satellite" | "cyberpunk" | "minimal";

export interface ThemeConfig {
  name: string;
  background: string;
  ocean: string;
  land: string;
  border: string;
  grid: string;
  text: string;
  accent: string;
  glow: string;
  marker: {
    active: string;
    validator: string;
    offline: string;
    selected: string;
  };
}

export const mapThemes: Record<MapTheme, ThemeConfig> = {
  dark: {
    name: "Dark",
    background: "#050508",
    ocean: "#0a0a0f",
    land: "#1a1a24",
    border: "#2a2a3a",
    grid: "rgba(0, 245, 255, 0.05)",
    text: "#e0e0e0",
    accent: "#00F5FF",
    glow: "rgba(0, 245, 255, 0.3)",
    marker: {
      active: "#00F5FF",
      validator: "#B24DFF",
      offline: "#6B7280",
      selected: "#FF2D9E",
    },
  },
  
  light: {
    name: "Light",
    background: "#f8f9fa",
    ocean: "#e3f2fd",
    land: "#ffffff",
    border: "#bbdefb",
    grid: "rgba(0, 150, 200, 0.1)",
    text: "#1a1a2e",
    accent: "#0066cc",
    glow: "rgba(0, 102, 204, 0.2)",
    marker: {
      active: "#0066cc",
      validator: "#7c3aed",
      offline: "#9ca3af",
      selected: "#ec4899",
    },
  },
  
  satellite: {
    name: "Satellite",
    background: "#0d1117",
    ocean: "#1a2332",
    land: "#2d3748",
    border: "#4a5568",
    grid: "rgba(255, 255, 255, 0.05)",
    text: "#e2e8f0",
    accent: "#00F5FF",
    glow: "rgba(0, 245, 255, 0.4)",
    marker: {
      active: "#00F5FF",
      validator: "#B24DFF",
      offline: "#718096",
      selected: "#FF2D9E",
    },
  },
  
  cyberpunk: {
    name: "Cyberpunk",
    background: "#0a0014",
    ocean: "#1a0033",
    land: "#2d0052",
    border: "#4a0080",
    grid: "rgba(255, 0, 255, 0.1)",
    text: "#ff00ff",
    accent: "#ff00ff",
    glow: "rgba(255, 0, 255, 0.5)",
    marker: {
      active: "#00ffff",
      validator: "#ff00ff",
      offline: "#4a4a4a",
      selected: "#ffff00",
    },
  },
  
  minimal: {
    name: "Minimal",
    background: "#000000",
    ocean: "#000000",
    land: "#111111",
    border: "#222222",
    grid: "transparent",
    text: "#888888",
    accent: "#ffffff",
    glow: "rgba(255, 255, 255, 0.2)",
    marker: {
      active: "#ffffff",
      validator: "#aaaaaa",
      offline: "#333333",
      selected: "#ffffff",
    },
  },
};

// Leaflet-specific tile layer URLs for each theme
export const tileLayers: Record<MapTheme, string> = {
  dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  light: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  satellite: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  cyberpunk: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  minimal: "https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png",
};

// Three.js globe colors for 3D view
export const globeColors: Record<MapTheme, {
  atmosphere: string;
  ocean: string;
  land: string;
  emissive: string;
}> = {
  dark: {
    atmosphere: "#00F5FF",
    ocean: "#0a0a1a",
    land: "#1a1a2e",
    emissive: "#00F5FF",
  },
  light: {
    atmosphere: "#0066cc",
    ocean: "#4a90d9",
    land: "#8b7355",
    emissive: "#ffffff",
  },
  satellite: {
    atmosphere: "#4a90e2",
    ocean: "#1a2332",
    land: "#2d4a3e",
    emissive: "#ffffff",
  },
  cyberpunk: {
    atmosphere: "#ff00ff",
    ocean: "#2a0052",
    land: "#4a0080",
    emissive: "#ff00ff",
  },
  minimal: {
    atmosphere: "#ffffff",
    ocean: "#0a0a0a",
    land: "#1a1a1a",
    emissive: "#ffffff",
  },
};

// CSS custom properties generator
export const generateThemeCSS = (theme: ThemeConfig): string => {
  return `
    --map-bg: ${theme.background};
    --map-ocean: ${theme.ocean};
    --map-land: ${theme.land};
    --map-border: ${theme.border};
    --map-grid: ${theme.grid};
    --map-text: ${theme.text};
    --map-accent: ${theme.accent};
    --map-glow: ${theme.glow};
    --marker-active: ${theme.marker.active};
    --marker-validator: ${theme.marker.validator};
    --marker-offline: ${theme.marker.offline};
    --marker-selected: ${theme.marker.selected};
  `;
};

export default mapThemes;
