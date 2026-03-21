"use client";

/**
 * Region Highlight Component
 * Animated region borders and selection overlays
 */

import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMapTheme } from "../styles/ThemeProvider";

interface RegionData {
  id: string;
  name: string;
  path: string; // SVG path string
  center: { x: number; y: number };
  nodeCount: number;
  activeNodes: number;
}

interface RegionHighlightProps {
  regions: RegionData[];
  selectedRegion?: string | null;
  onRegionClick?: (region: RegionData) => void;
  showStats?: boolean;
}

// SVG paths for common regions (simplified)
export const regionPaths: Record<string, string> = {
  northAmerica: "M 50,50 L 300,50 L 280,200 L 100,250 Z",
  southAmerica: "M 200,260 L 300,280 L 280,450 L 180,420 Z",
  europe: "M 420,80 L 550,70 L 560,150 L 450,160 Z",
  africa: "M 430,170 L 550,180 L 520,380 L 440,350 Z",
  asia: "M 560,60 L 850,50 L 820,250 L 570,240 Z",
  oceania: "M 750,300 L 900,280 L 880,420 L 730,400 Z",
};

// Region center points (percentage-based)
export const regionCenters: Record<string, { x: number; y: number }> = {
  northAmerica: { x: 20, y: 25 },
  southAmerica: { x: 25, y: 55 },
  europe: { x: 52, y: 22 },
  africa: { x: 52, y: 45 },
  asia: { x: 70, y: 28 },
  oceania: { x: 82, y: 60 },
};

function RegionPath({
  region,
  isSelected,
  isHovered,
  onClick,
  onHover,
}: {
  region: RegionData;
  isSelected: boolean;
  isHovered: boolean;
  onClick: () => void;
  onHover: (hovered: boolean) => void;
}) {
  const { themeConfig } = useMapTheme();
  
  const baseColor = themeConfig.accent;
  const glowOpacity = isSelected ? 0.5 : isHovered ? 0.3 : 0.1;
  
  return (
    <motion.g
      onClick={onClick}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      style={{ cursor: "pointer" }}
    >
      {/* Background glow */}
      <motion.path
        d={region.path}
        fill={baseColor}
        initial={{ opacity: 0 }}
        animate={{ opacity: glowOpacity }}
        transition={{ duration: 0.3 }}
      />
      
      {/* Animated border */}
      <motion.path
        d={region.path}
        fill="none"
        stroke={baseColor}
        strokeWidth={isSelected ? 3 : isHovered ? 2 : 1}
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ 
          pathLength: 1, 
          opacity: isSelected ? 1 : isHovered ? 0.8 : 0.4,
        }}
        transition={{ 
          pathLength: { duration: 1, ease: "easeInOut" },
          opacity: { duration: 0.3 }
        }}
      />
      
      {/* Dash animation for selected */}
      {isSelected && (
        <motion.path
          d={region.path}
          fill="none"
          stroke={baseColor}
          strokeWidth={2}
          strokeDasharray="10,10"
          initial={{ strokeDashoffset: 0 }}
          animate={{ strokeDashoffset: -20 }}
          transition={{
            duration: 1,
            repeat: Infinity,
            ease: "linear",
          }}
        />
      )}
    </motion.g>
  );
}

function RegionLabel({
  region,
  isSelected,
}: {
  region: RegionData;
  isSelected: boolean;
}) {
  const { themeConfig } = useMapTheme();
  
  return (
    <motion.g
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ 
        opacity: isSelected ? 1 : 0.7, 
        scale: isSelected ? 1 : 0.9 
      }}
      transition={{ duration: 0.3 }}
    >
      {/* Background pill */}
      <rect
        x={region.center.x - 40}
        y={region.center.y - 15}
        width={80}
        height={30}
        rx={15}
        fill="rgba(0,0,0,0.7)"
        stroke={themeConfig.accent}
        strokeWidth={1}
        opacity={isSelected ? 1 : 0.5}
      />
      
      {/* Region name */}
      <text
        x={region.center.x}
        y={region.center.y + 5}
        textAnchor="middle"
        fill={themeConfig.text}
        fontSize={12}
        fontWeight={isSelected ? "bold" : "normal"}
      >
        {region.name}
      </text>
      
      {/* Node count badge */}
      <circle
        cx={region.center.x + 35}
        cy={region.center.y - 10}
        r={10}
        fill={themeConfig.marker.active}
      />
      <text
        x={region.center.x + 35}
        y={region.center.y - 6}
        textAnchor="middle"
        fill="#000"
        fontSize={10}
        fontWeight="bold"
      >
        {region.nodeCount}
      </text>
    </motion.g>
  );
}

export function RegionHighlight({
  regions,
  selectedRegion,
  onRegionClick,
  showStats = true,
}: RegionHighlightProps) {
  const [hoveredRegion, setHoveredRegion] = useState<string | null>(null);
  const { themeConfig } = useMapTheme();
  
  return (
    <div className="absolute inset-0 pointer-events-none">
      <svg className="w-full h-full" viewBox="0 0 1000 500" preserveAspectRatio="xMidYMid slice">
        <AnimatePresence>
          {regions.map((region) => (
            <RegionPath
              key={region.id}
              region={region}
              isSelected={selectedRegion === region.id}
              isHovered={hoveredRegion === region.id}
              onClick={() => onRegionClick?.(region)}
              onHover={(hovered) => setHoveredRegion(hovered ? region.id : null)}
            />
          ))}
        </AnimatePresence>
        
        {showStats && regions.map((region) => (
          <RegionLabel
            key={`${region.id}-label`}
            region={region}
            isSelected={selectedRegion === region.id}
          />
        ))}
      </svg>
    </div>
  );
}

// Simplified version for just showing active regions as pulsing circles
interface RegionPulseProps {
  regions: { id: string; x: number; y: number; intensity: number }[];
}

export function RegionPulse({ regions }: RegionPulseProps) {
  const { themeConfig } = useMapTheme();
  
  return (
    <div className="absolute inset-0 pointer-events-none">
      {regions.map((region) => (
        <motion.div
          key={region.id}
          className="absolute rounded-full"
          style={{
            left: `${region.x}%`,
            top: `${region.y}%`,
            width: 100 + region.intensity * 50,
            height: 100 + region.intensity * 50,
            transform: "translate(-50%, -50%)",
            background: `radial-gradient(circle, ${themeConfig.accent}20 0%, transparent 70%)`,
          }}
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.3, 0.6, 0.3],
          }}
          transition={{
            duration: 2 + region.intensity,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}

// Heat map overlay showing node density
interface HeatmapOverlayProps {
  data: { x: number; y: number; value: number }[];
  maxValue?: number;
}

export function HeatmapOverlay({ data, maxValue = 100 }: HeatmapOverlayProps) {
  const { themeConfig } = useMapTheme();
  
  return (
    <div className="absolute inset-0 pointer-events-none opacity-50">
      {data.map((point, i) => {
        const intensity = point.value / maxValue;
        const size = 20 + intensity * 80;
        
        return (
          <motion.div
            key={i}
            className="absolute rounded-full blur-xl"
            style={{
              left: `${point.x}%`,
              top: `${point.y}%`,
              width: size,
              height: size,
              transform: "translate(-50%, -50%)",
              background: `radial-gradient(circle, ${themeConfig.accent} 0%, transparent 70%)`,
              opacity: intensity * 0.5,
            }}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: intensity * 0.5 }}
            transition={{ duration: 0.5, delay: i * 0.02 }}
          />
        );
      })}
    </div>
  );
}

export default RegionHighlight;
