"use client";

/**
 * Theme Toggle Control
 * Switch between map themes with animated transitions
 */

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMapTheme, MapTheme } from "../styles/ThemeProvider";
import { GlassPanel } from "../components/GlassPanel";

const themes: { id: MapTheme; label: string; icon: string; color: string }[] = [
  { id: "dark", label: "Dark", icon: "🌙", color: "#00F5FF" },
  { id: "light", label: "Light", icon: "☀️", color: "#0066cc" },
  { id: "satellite", label: "Sat", icon: "🛰️", color: "#4a90e2" },
  { id: "cyberpunk", label: "Cyber", icon: "⚡", color: "#ff00ff" },
  { id: "minimal", label: "Min", icon: "◼️", color: "#ffffff" },
];

interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className = "" }: ThemeToggleProps) {
  const { theme, setTheme, is3D, setIs3D } = useMapTheme();
  const [isExpanded, setIsExpanded] = useState(false);

  const currentTheme = themes.find((t) => t.id === theme);

  return (
    <div className={`relative ${className}`}>
      <GlassPanel className="p-1.5" intensity="light">
        <div className="flex items-center gap-1">
          {/* Current Theme Button */}
          <motion.button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-2 px-3 py-2 rounded-md transition-colors"
            style={{ 
              backgroundColor: `${currentTheme?.color}20`,
              border: `1px solid ${currentTheme?.color}40`,
            }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <span className="text-lg">{currentTheme?.icon}</span>
            <span 
              className="text-sm font-medium hidden sm:block"
              style={{ color: currentTheme?.color }}
            >
              {currentTheme?.label}
            </span>
          </motion.button>

          {/* 3D Toggle */}
          <motion.button
            onClick={() => setIs3D(!is3D)}
            className={`px-3 py-2 rounded-md transition-all ${
              is3D ? "bg-cyan-500/20 border border-cyan-500/50" : "hover:bg-white/5"
            }`}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            title="Toggle 3D Globe View"
          >
            <span className={`text-lg ${is3D ? "text-cyan-400" : "text-white/60"}`}>
              🌐
            </span>
          </motion.button>
        </div>
      </GlassPanel>

      {/* Expanded Theme Menu */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="absolute top-full mt-2 right-0 z-50"
          >
            <GlassPanel className="p-2 min-w-[140px]" intensity="medium">
              <div className="space-y-1">
                {themes.map((t) => (
                  <motion.button
                    key={t.id}
                    onClick={() => {
                      setTheme(t.id);
                      setIsExpanded(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-all ${
                      theme === t.id
                        ? "bg-white/10"
                        : "hover:bg-white/5"
                    }`}
                    whileHover={{ x: 4 }}
                  >
                    <span className="text-lg">{t.icon}</span>
                    <span 
                      className="font-medium"
                      style={{ color: theme === t.id ? t.color : "#ffffff" }}
                    >
                      {t.label}
                    </span>
                    {theme === t.id && (
                      <motion.div
                        layoutId="activeIndicator"
                        className="ml-auto w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: t.color }}
                      />
                    )}
                  </motion.button>
                ))}
              </div>
            </GlassPanel>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default ThemeToggle;
