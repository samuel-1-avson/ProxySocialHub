"use client";

/**
 * Simplified 3D Globe View Component
 * Uses react-globe.gl (already in dependencies) instead of raw Three.js
 * This is a lighter alternative that doesn't require @react-three/fiber
 */

import React, { useMemo, useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { useMapTheme } from "../styles";

// Dynamically import Globe to avoid SSR issues
const Globe = dynamic(() => import("react-globe.gl"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full">
      <div className="w-12 h-12 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
    </div>
  ),
});

interface NodeData {
  id: string;
  lat: number;
  lon: number;
  isActive: boolean;
  isValidator: boolean;
  city?: string;
  country?: string;
}

interface GlobeViewSimpleProps {
  nodes: NodeData[];
  selectedNodeId?: string | null;
  onNodeClick?: (node: NodeData) => void;
  width?: number;
  height?: number;
}

export function GlobeViewSimple({
  nodes,
  selectedNodeId,
  onNodeClick,
  width = 800,
  height = 600,
}: GlobeViewSimpleProps) {
  const [isLoading, setIsLoading] = useState(true);
  const { theme, themeConfig } = useMapTheme();

  // Transform nodes for globe.gl format
  const globeNodes = useMemo(() => {
    return nodes.map((node) => ({
      lat: node.lat,
      lng: node.lon,
      size: node.isValidator ? 1.5 : node.isActive ? 1 : 0.5,
      color: node.isValidator
        ? themeConfig.marker.validator
        : node.isActive
        ? themeConfig.marker.active
        : themeConfig.marker.offline,
      nodeData: node,
    }));
  }, [nodes, themeConfig]);

  // Generate arcs between active nodes
  const arcs = useMemo(() => {
    const activeNodes = nodes.filter((n) => n.isActive);
    const connections: {
      startLat: number;
      startLng: number;
      endLat: number;
      endLng: number;
      color: string;
    }[] = [];

    activeNodes.forEach((source, i) => {
      activeNodes.slice(i + 1).forEach((target) => {
        const dist = Math.sqrt(
          Math.pow(source.lat - target.lat, 2) +
            Math.pow(source.lon - target.lon, 2)
        );
        if (dist < 60) {
          connections.push({
            startLat: source.lat,
            startLng: source.lon,
            endLat: target.lat,
            endLng: target.lon,
            color: themeConfig.accent,
          });
        }
      });
    });

    return connections;
  }, [nodes, themeConfig]);

  // Globe colors based on theme
  const globeColors = useMemo(() => {
    const colors: Record<string, { background: string; globe: string; atmosphere: string }> = {
      dark: {
        background: "#050508",
        globe: "#0a0a1a",
        atmosphere: "#00F5FF",
      },
      light: {
        background: "#f8f9fa",
        globe: "#e3f2fd",
        atmosphere: "#0066cc",
      },
      satellite: {
        background: "#0d1117",
        globe: "#1a2332",
        atmosphere: "#4a90e2",
      },
      cyberpunk: {
        background: "#0a0014",
        globe: "#2d0052",
        atmosphere: "#ff00ff",
      },
      minimal: {
        background: "#000000",
        globe: "#0a0a0a",
        atmosphere: "#ffffff",
      },
    };
    return colors[theme] || colors.dark;
  }, [theme]);

  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 1000);
    return () => clearTimeout(timer);
  }, []);

  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center"
        style={{ width, height }}
      >
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center"
        >
          <div className="w-12 h-12 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-cyan-400 text-sm">Loading 3D Globe...</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="relative" style={{ width, height }}>
      <Globe
        width={width}
        height={height}
        backgroundColor={globeColors.background}
        globeImageUrl="//unpkg.com/three-globe/example/img/earth-dark.jpg"
        bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
        showAtmosphere={true}
        atmosphereColor={globeColors.atmosphere}
        atmosphereAltitude={0.25}
        pointsData={globeNodes}
        pointLat="lat"
        pointLng="lng"
        pointColor="color"
        pointAltitude={0.01}
        pointRadius="size"
        pointsMerge={true}
        arcsData={arcs}
        arcColor="color"
        arcDashLength={0.4}
        arcDashGap={0.2}
        arcDashAnimateTime={2000}
        arcStroke={0.5}
        onPointClick={(point: { nodeData: NodeData }) => {
          onNodeClick?.(point.nodeData);
        }}
        pointLabel={(point: { nodeData: NodeData }) => `
          <div style="
            background: rgba(0,0,0,0.8);
            padding: 8px 12px;
            border-radius: 8px;
            border: 1px solid ${point.nodeData.isValidator ? "#B24DFF" : "#00F5FF"};
            color: white;
            font-family: sans-serif;
          ">
            <strong>${point.nodeData.city || point.nodeData.country}</strong><br/>
            <span style="font-size: 12px; opacity: 0.8;">
              ${point.nodeData.isActive ? "● Online" : "○ Offline"}
              ${point.nodeData.isValidator ? " ★ Validator" : ""}
            </span>
          </div>
        `}
      />

      {/* Controls hint */}
      <div className="absolute bottom-4 left-4 text-white/40 text-xs bg-black/50 px-3 py-2 rounded-lg backdrop-blur-sm">
        <p>🖱️ Drag to rotate • 🖱️ Scroll to zoom • 👆 Click nodes</p>
      </div>

      {/* Selected indicator */}
      {selectedNodeId && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute top-4 left-4 bg-black/80 backdrop-blur-sm border border-cyan-500/30 rounded-lg px-4 py-2"
        >
          <span className="text-cyan-400 text-sm">
            Selected: {nodes.find((n) => n.id === selectedNodeId)?.city || "Unknown"}
          </span>
        </motion.div>
      )}
    </div>
  );
}

export default GlobeViewSimple;
