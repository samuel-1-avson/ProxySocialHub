"use client";

/**
 * Statistics Widget Component
 * Animated counter with trend indicator
 */

import React, { useEffect, useState } from "react";
import { motion, useSpring, useTransform } from "framer-motion";

interface StatWidgetProps {
  label: string;
  value: number;
  suffix?: string;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  icon?: React.ReactNode;
  color?: "cyan" | "purple" | "green" | "yellow";
  delay?: number;
}

const colorMap = {
  cyan: {
    primary: "#00F5FF",
    glow: "rgba(0, 245, 255, 0.3)",
    bg: "rgba(0, 245, 255, 0.1)",
  },
  purple: {
    primary: "#B24DFF",
    glow: "rgba(178, 77, 255, 0.3)",
    bg: "rgba(178, 77, 255, 0.1)",
  },
  green: {
    primary: "#39FF14",
    glow: "rgba(57, 255, 20, 0.3)",
    bg: "rgba(57, 255, 20, 0.1)",
  },
  yellow: {
    primary: "#FFD700",
    glow: "rgba(255, 215, 0, 0.3)",
    bg: "rgba(255, 215, 0, 0.1)",
  },
};

function AnimatedCounter({ value, suffix = "" }: { value: number; suffix?: string }) {
  const [displayValue, setDisplayValue] = useState(0);
  
  const spring = useSpring(0, {
    stiffness: 100,
    damping: 30,
    duration: 1.5,
  });
  
  const rounded = useTransform(spring, (latest) => Math.round(latest));
  
  useEffect(() => {
    spring.set(value);
  }, [value, spring]);
  
  useEffect(() => {
    const unsubscribe = rounded.on("change", (v) => {
      setDisplayValue(v);
    });
    return () => unsubscribe();
  }, [rounded]);
  
  return (
    <span>
      {displayValue.toLocaleString()}
      {suffix}
    </span>
  );
}

export function StatWidget({
  label,
  value,
  suffix = "",
  trend,
  trendValue,
  icon,
  color = "cyan",
  delay = 0,
}: StatWidgetProps) {
  const colors = colorMap[color];
  
  const trendColors = {
    up: "#39FF14",
    down: "#FF4444",
    neutral: "#888888",
  };
  
  const trendIcons = {
    up: "▲",
    down: "▼",
    neutral: "●",
  };

  return (
    <motion.div
      className="relative p-4 rounded-xl overflow-hidden"
      style={{
        background: "rgba(10, 10, 15, 0.6)",
        backdropFilter: "blur(10px)",
        border: `1px solid ${colors.primary}20`,
      }}
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        duration: 0.5,
        delay: delay,
        ease: [0.22, 1, 0.36, 1],
      }}
      whileHover={{
        scale: 1.02,
        boxShadow: `0 0 30px ${colors.glow}`,
        borderColor: `${colors.primary}40`,
      }}
    >
      {/* Background glow */}
      <div
        className="absolute inset-0 opacity-20"
        style={{
          background: `radial-gradient(circle at top right, ${colors.primary}, transparent 70%)`,
        }}
      />
      
      {/* Content */}
      <div className="relative z-10">
        {/* Icon and Label */}
        <div className="flex items-center gap-2 mb-2">
          {icon && (
            <div
              className="p-1.5 rounded-md"
              style={{
                background: colors.bg,
                color: colors.primary,
              }}
            >
              {icon}
            </div>
          )}
          <span className="text-xs font-medium text-white/60 uppercase tracking-wider">
            {label}
          </span>
        </div>
        
        {/* Value */}
        <div
          className="text-3xl font-bold tracking-tight"
          style={{ color: colors.primary }}
        >
          <AnimatedCounter value={value} suffix={suffix} />
        </div>
        
        {/* Trend */}
        {trend && (
          <motion.div
            className="flex items-center gap-1 mt-2 text-xs"
            style={{ color: trendColors[trend] }}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: delay + 0.3 }}
          >
            <span>{trendIcons[trend]}</span>
            <span>{trendValue}</span>
          </motion.div>
        )}
      </div>
      
      {/* Bottom accent line */}
      <motion.div
        className="absolute bottom-0 left-0 h-0.5"
        style={{
          background: colors.primary,
          boxShadow: `0 0 10px ${colors.primary}`,
        }}
        initial={{ width: "0%" }}
        animate={{ width: "100%" }}
        transition={{ delay: delay + 0.2, duration: 0.8, ease: "easeOut" }}
      />
    </motion.div>
  );
}

export default StatWidget;
