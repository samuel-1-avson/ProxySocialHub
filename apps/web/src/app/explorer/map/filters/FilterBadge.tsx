"use client";

/**
 * Filter Badge Component
 * Shows active filter count with quick actions
 */

import React from "react";
import { motion } from "framer-motion";

interface FilterBadgeProps {
  count: number;
  onClick: () => void;
  onClear: () => void;
  className?: string;
}

export function FilterBadge({ count, onClick, onClear, className = "" }: FilterBadgeProps) {
  if (count === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8, y: -10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.8, y: -10 }}
      className={`flex items-center gap-2 ${className}`}
    >
      <motion.button
        onClick={onClick}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-cyan-500/20 border border-cyan-500/40 text-cyan-400 text-sm font-medium"
      >
        <span>🔍</span>
        <span>{count} filter{count !== 1 ? "s" : ""} active</span>
      </motion.button>

      <motion.button
        onClick={onClear}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className="p-1.5 rounded-full bg-white/5 text-white/40 hover:text-white hover:bg-white/10 transition-colors"
        title="Clear all filters"
      >
        ✕
      </motion.button>
    </motion.div>
  );
}

// Node count badge showing filtered results
interface NodeCountBadgeProps {
  total: number;
  filtered: number;
  className?: string;
}

export function NodeCountBadge({ total, filtered, className = "" }: NodeCountBadgeProps) {
  const percentage = total > 0 ? Math.round((filtered / total) * 100) : 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={`flex items-center gap-3 px-4 py-2 rounded-full bg-black/40 backdrop-blur-sm border border-white/10 ${className}`}
    >
      <div className="flex items-center gap-2">
        <span className="text-white font-semibold">{filtered}</span>
        <span className="text-white/40 text-sm">/ {total} nodes</span>
      </div>

      {/* Progress bar */}
      <div className="w-20 h-1.5 bg-white/10 rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-gradient-to-r from-cyan-500 to-purple-500 rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>

      <span className="text-white/40 text-xs">{percentage}%</span>
    </motion.div>
  );
}

// Preset filter buttons
interface FilterPresetsProps {
  onSelectPreset: (preset: string) => void;
  className?: string;
}

const presets = [
  { id: "all", name: "All Nodes", icon: "🌐" },
  { id: "active", name: "Active Only", icon: "✅" },
  { id: "validators", name: "Validators", icon: "★" },
  { id: "high_perf", name: "High Performance", icon: "⚡" },
  { id: "my_region", name: "My Region", icon: "📍" },
];

export function FilterPresets({ onSelectPreset, className = "" }: FilterPresetsProps) {
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {presets.map((preset) => (
        <motion.button
          key={preset.id}
          onClick={() => onSelectPreset(preset.id)}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-white/70 text-xs hover:bg-white/10 hover:text-white transition-colors"
        >
          <span>{preset.icon}</span>
          <span>{preset.name}</span>
        </motion.button>
      ))}
    </div>
  );
}

export default FilterBadge;
