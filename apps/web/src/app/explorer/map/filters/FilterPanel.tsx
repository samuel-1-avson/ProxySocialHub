"use client";

/**
 * Filter Panel Component
 * Comprehensive filtering with animated UI
 */

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GlassPanel } from "../components/GlassPanel";
import { SearchBar } from "./SearchBar";

interface FilterState {
  search: string;
  regions: string[];
  statuses: ("active" | "validator" | "offline")[];
  minUptime: number;
  maxLatency: number;
  minBandwidth: number;
}

interface FilterPanelProps {
  filters: FilterState;
  onFilterChange: (filters: FilterState) => void;
  onReset: () => void;
  nodeCount: number;
  filteredCount: number;
  className?: string;
}

const regions = [
  { id: "north_america", name: "North America", icon: "🌎" },
  { id: "south_america", name: "South America", icon: "🌎" },
  { id: "europe", name: "Europe", icon: "🌍" },
  { id: "africa", name: "Africa", icon: "🌍" },
  { id: "asia", name: "Asia", icon: "🌏" },
  { id: "oceania", name: "Oceania", icon: "🌏" },
];

const statuses = [
  { id: "active", name: "Active", color: "#39FF14", icon: "●" },
  { id: "validator", name: "Validator", color: "#B24DFF", icon: "★" },
  { id: "offline", name: "Offline", color: "#FF4444", icon: "○" },
];

// Chip component for selected filters
function FilterChip({
  label,
  onRemove,
  color = "cyan",
}: {
  label: string;
  onRemove: () => void;
  color?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8 }}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
      style={{
        backgroundColor: `${color}20`,
        border: `1px solid ${color}40`,
        color,
      }}
    >
      <span>{label}</span>
      <button
        onClick={onRemove}
        className="hover:opacity-70 transition-opacity"
      >
        ×
      </button>
    </motion.div>
  );
}

// Toggle button for status filters
function StatusToggle({
  status,
  isSelected,
  onToggle,
}: {
  status: (typeof statuses)[0];
  isSelected: boolean;
  onToggle: () => void;
}) {
  return (
    <motion.button
      onClick={onToggle}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all ${
        isSelected
          ? "bg-white/10 border border-white/20"
          : "hover:bg-white/5 border border-transparent"
      }`}
      style={{
        backgroundColor: isSelected ? `${status.color}15` : undefined,
        borderColor: isSelected ? `${status.color}40` : undefined,
      }}
    >
      <span style={{ color: status.color }}>{status.icon}</span>
      <span className={isSelected ? "text-white" : "text-white/60"}>
        {status.name}
      </span>
    </motion.button>
  );
}

// Region checkbox
function RegionCheckbox({
  region,
  isSelected,
  onToggle,
}: {
  region: (typeof regions)[0];
  isSelected: boolean;
  onToggle: () => void;
}) {
  return (
    <motion.button
      onClick={onToggle}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all w-full ${
        isSelected
          ? "bg-cyan-500/10 border border-cyan-500/30"
          : "hover:bg-white/5 border border-transparent"
      }`}
    >
      <span className="text-lg">{region.icon}</span>
      <span className={isSelected ? "text-white" : "text-white/60"}>
        {region.name}
      </span>
      {isSelected && (
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="ml-auto text-cyan-400"
        >
          ✓
        </motion.span>
      )}
    </motion.button>
  );
}

// Slider for numeric filters
function FilterSlider({
  label,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  const percentage = ((value - min) / (max - min)) * 100;

  return (
    <div className="mb-4">
      <div className="flex justify-between text-sm mb-2">
        <span className="text-white/60">{label}</span>
        <span className="text-cyan-400 font-medium">
          {value}
          {unit}
        </span>
      </div>
      <div className="relative h-2 bg-white/10 rounded-full">
        <motion.div
          className="absolute h-full bg-gradient-to-r from-cyan-500 to-purple-500 rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.3 }}
        />
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
      </div>
      <div className="flex justify-between text-xs text-white/30 mt-1">
        <span>
          {min}
          {unit}
        </span>
        <span>
          {max}
          {unit}
        </span>
      </div>
    </div>
  );
}

export function FilterPanel({
  filters,
  onFilterChange,
  onReset,
  nodeCount,
  filteredCount,
  className = "",
}: FilterPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasActiveFilters =
    filters.regions.length > 0 ||
    filters.statuses.length > 0 ||
    filters.search ||
    filters.minUptime > 0 ||
    filters.maxLatency < 1000 ||
    filters.minBandwidth > 0;

  const toggleRegion = (regionId: string) => {
    const newRegions = filters.regions.includes(regionId)
      ? filters.regions.filter((r) => r !== regionId)
      : [...filters.regions, regionId];
    onFilterChange({ ...filters, regions: newRegions });
  };

  const toggleStatus = (status: "active" | "validator" | "offline") => {
    const newStatuses = filters.statuses.includes(status)
      ? filters.statuses.filter((s) => s !== status)
      : [...filters.statuses, status];
    onFilterChange({ ...filters, statuses: newStatuses });
  };

  const getActiveFilterChips = () => {
    const chips: { label: string; onRemove: () => void; color: string }[] = [];

    if (filters.search) {
      chips.push({
        label: `Search: "${filters.search}"`,
        onRemove: () => onFilterChange({ ...filters, search: "" }),
        color: "#00F5FF",
      });
    }

    filters.regions.forEach((regionId) => {
      const region = regions.find((r) => r.id === regionId);
      if (region) {
        chips.push({
          label: region.name,
          onRemove: () => toggleRegion(regionId),
          color: "#B24DFF",
        });
      }
    });

    filters.statuses.forEach((status) => {
      const statusConfig = statuses.find((s) => s.id === status);
      if (statusConfig) {
        chips.push({
          label: statusConfig.name,
          onRemove: () => toggleStatus(status),
          color: statusConfig.color,
        });
      }
    });

    if (filters.minUptime > 0) {
      chips.push({
        label: `Uptime ≥${filters.minUptime}%`,
        onRemove: () => onFilterChange({ ...filters, minUptime: 0 }),
        color: "#39FF14",
      });
    }

    if (filters.maxLatency < 1000) {
      chips.push({
        label: `Latency ≤${filters.maxLatency}ms`,
        onRemove: () => onFilterChange({ ...filters, maxLatency: 1000 }),
        color: "#FFD700",
      });
    }

    return chips;
  };

  return (
    <div className={className}>
      {/* Collapsed View - Just Search */}
      {!isExpanded && (
        <GlassPanel intensity="light" className="p-2">
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <SearchBar
                placeholder="Search nodes..."
                onSearch={(query) => onFilterChange({ ...filters, search: query })}
              />
            </div>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setIsExpanded(true)}
              className="px-4 py-3 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-sm font-medium hover:bg-cyan-500/20 transition-colors"
            >
              Filters
              {hasActiveFilters && (
                <span className="ml-2 px-1.5 py-0.5 rounded-full bg-cyan-500 text-black text-xs">
                  !
                </span>
              )}
            </motion.button>
          </div>

          {/* Active Filter Chips */}
          <AnimatePresence>
            {hasActiveFilters && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-white/10"
              >
                {getActiveFilterChips().map((chip, index) => (
                  <FilterChip
                    key={index}
                    label={chip.label}
                    onRemove={chip.onRemove}
                    color={chip.color}
                  />
                ))}
                <button
                  onClick={onReset}
                  className="text-xs text-white/40 hover:text-white underline"
                >
                  Clear all
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </GlassPanel>
      )}

      {/* Expanded View - Full Filter Panel */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
          >
            <GlassPanel intensity="heavy" className="overflow-hidden">
              {/* Header */}
              <div className="p-4 border-b border-white/10 flex items-center justify-between">
                <div>
                  <h3 className="text-white font-semibold">Filter Nodes</h3>
                  <p className="text-white/40 text-sm">
                    Showing {filteredCount} of {nodeCount} nodes
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={onReset}
                    className="px-3 py-1.5 text-sm text-white/60 hover:text-white transition-colors"
                  >
                    Reset
                  </button>
                  <button
                    onClick={() => setIsExpanded(false)}
                    className="p-2 text-white/60 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div className="p-4 space-y-6 max-h-[calc(100vh-300px)] overflow-y-auto">
                {/* Search */}
                <div>
                  <label className="text-white/60 text-sm mb-2 block">Search</label>
                  <SearchBar
                    placeholder="Search by name, city, country..."
                    onSearch={(query) => onFilterChange({ ...filters, search: query })}
                  />
                </div>

                {/* Status Filter */}
                <div>
                  <label className="text-white/60 text-sm mb-2 block">Status</label>
                  <div className="flex gap-2">
                    {statuses.map((status) => (
                      <StatusToggle
                        key={status.id}
                        status={status}
                        isSelected={filters.statuses.includes(
                          status.id as "active" | "validator" | "offline"
                        )}
                        onToggle={() =>
                          toggleStatus(status.id as "active" | "validator" | "offline")
                        }
                      />
                    ))}
                  </div>
                </div>

                {/* Region Filter */}
                <div>
                  <label className="text-white/60 text-sm mb-2 block">Region</label>
                  <div className="grid grid-cols-2 gap-2">
                    {regions.map((region) => (
                      <RegionCheckbox
                        key={region.id}
                        region={region}
                        isSelected={filters.regions.includes(region.id)}
                        onToggle={() => toggleRegion(region.id)}
                      />
                    ))}
                  </div>
                </div>

                {/* Performance Thresholds */}
                <div>
                  <label className="text-white/60 text-sm mb-3 block">Performance Thresholds</label>
                  <FilterSlider
                    label="Minimum Uptime"
                    value={filters.minUptime}
                    min={0}
                    max={100}
                    unit="%"
                    onChange={(value) => onFilterChange({ ...filters, minUptime: value })}
                  />
                  <FilterSlider
                    label="Maximum Latency"
                    value={filters.maxLatency}
                    min={10}
                    max={1000}
                    unit="ms"
                    onChange={(value) => onFilterChange({ ...filters, maxLatency: value })}
                  />
                  <FilterSlider
                    label="Minimum Bandwidth"
                    value={filters.minBandwidth}
                    min={0}
                    max={1000}
                    unit=" Mbps"
                    onChange={(value) => onFilterChange({ ...filters, minBandwidth: value })}
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="p-4 border-t border-white/10 bg-white/5">
                <button
                  onClick={() => setIsExpanded(false)}
                  className="w-full py-2.5 rounded-lg bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 font-medium hover:bg-cyan-500/30 transition-colors"
                >
                  Apply Filters ({filteredCount} nodes)
                </button>
              </div>
            </GlassPanel>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default FilterPanel;
