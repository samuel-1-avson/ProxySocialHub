"use client";

/**
 * Glassmorphism Panel Component
 * Reusable glass effect container
 */

import React from "react";
import { motion } from "framer-motion";

interface GlassPanelProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  glowColor?: "cyan" | "purple" | "pink" | "none";
  intensity?: "light" | "medium" | "heavy";
}

const glowColors = {
  cyan: "rgba(0, 245, 255, 0.1)",
  purple: "rgba(178, 77, 255, 0.1)",
  pink: "rgba(255, 45, 158, 0.1)",
  none: "transparent",
};

const intensities = {
  light: {
    background: "rgba(10, 10, 15, 0.5)",
    blur: "10px",
  },
  medium: {
    background: "rgba(10, 10, 15, 0.7)",
    blur: "20px",
  },
  heavy: {
    background: "rgba(10, 10, 15, 0.9)",
    blur: "30px",
  },
};

export function GlassPanel({
  children,
  className = "",
  style = {},
  glowColor = "none",
  intensity = "medium",
}: GlassPanelProps) {
  const intensityStyles = intensities[intensity];
  const glow = glowColors[glowColor];

  return (
    <motion.div
      className={`rounded-xl border border-white/10 ${className}`}
      style={{
        background: intensityStyles.background,
        backdropFilter: `blur(${intensityStyles.blur}) saturate(180%)`,
        WebkitBackdropFilter: `blur(${intensityStyles.blur}) saturate(180%)`,
        boxShadow: `
          0 8px 32px rgba(0, 0, 0, 0.4),
          0 0 0 1px rgba(255, 255, 255, 0.05),
          inset 0 1px 0 rgba(255, 255, 255, 0.05),
          ${glowColor !== "none" ? `0 0 40px ${glow}` : ""}
        `,
        ...style,
      }}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
    >
      {children}
    </motion.div>
  );
}

export default GlassPanel;
