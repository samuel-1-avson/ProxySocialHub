"use client";

/**
 * Map Theme Provider
 * Manages theme state and applies CSS variables
 */

import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { MapTheme, ThemeConfig, mapThemes, generateThemeCSS } from "./MapThemes";

interface ThemeContextType {
  theme: MapTheme;
  themeConfig: ThemeConfig;
  setTheme: (theme: MapTheme) => void;
  is3D: boolean;
  setIs3D: (is3D: boolean) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
  children: ReactNode;
  defaultTheme?: MapTheme;
}

export function ThemeProvider({ 
  children, 
  defaultTheme = "dark" 
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<MapTheme>(defaultTheme);
  const [is3D, setIs3D] = useState(false);

  // Load saved theme from localStorage on mount
  useEffect(() => {
    const savedTheme = localStorage.getItem("map-theme") as MapTheme;
    const saved3D = localStorage.getItem("map-3d") === "true";
    
    if (savedTheme && mapThemes[savedTheme]) {
      setThemeState(savedTheme);
    }
    setIs3D(saved3D);
  }, []);

  // Apply theme CSS variables when theme changes
  useEffect(() => {
    const themeConfig = mapThemes[theme];
    const css = generateThemeCSS(themeConfig);
    
    // Apply to document root
    document.documentElement.style.cssText += css;
    
    // Save to localStorage
    localStorage.setItem("map-theme", theme);
    localStorage.setItem("map-3d", String(is3D));
  }, [theme, is3D]);

  const setTheme = (newTheme: MapTheme) => {
    setThemeState(newTheme);
  };

  const value: ThemeContextType = {
    theme,
    themeConfig: mapThemes[theme],
    setTheme,
    is3D,
    setIs3D,
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useMapTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useMapTheme must be used within a ThemeProvider");
  }
  return context;
}

export default ThemeProvider;
