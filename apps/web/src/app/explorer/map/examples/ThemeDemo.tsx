"use client";

/**
 * Theme & 3D Demo Page
 * Showcases Phase 3 visual styles and 3D globe
 */

import React, { useState } from "react";
import { motion } from "framer-motion";
import { ThemeProvider, useMapTheme, mapThemes } from "../styles";
import { GlassPanel } from "../components/GlassPanel";
import { StatWidget } from "../stats/StatWidget";
import { ThemeToggle } from "../controls";
import { RegionHighlight, RegionPulse } from "../components";

// Mock nodes for demo
const mockNodes = [
  { id: "1", lat: 40.7128, lon: -74.0060, isActive: true, isValidator: true, city: "New York", country: "US" },
  { id: "2", lat: 51.5074, lon: -0.1278, isActive: true, isValidator: false, city: "London", country: "UK" },
  { id: "3", lat: 35.6762, lon: 139.6503, isActive: true, isValidator: true, city: "Tokyo", country: "JP" },
  { id: "4", lat: -33.8688, lon: 151.2093, isActive: true, isValidator: false, city: "Sydney", country: "AU" },
  { id: "5", lat: 5.6037, lon: -0.1870, isActive: true, isValidator: false, city: "Accra", country: "GH" },
  { id: "6", lat: -23.5505, lon: -46.6333, isActive: false, isValidator: false, city: "Sao Paulo", country: "BR" },
];

// Mock regions
const regions = [
  { id: "na", name: "North America", path: "M 150,100 L 350,80 L 380,200 L 200,250 Z", center: { x: 25, y: 28 }, nodeCount: 12, activeNodes: 10 },
  { id: "sa", name: "South America", path: "M 280,260 L 380,280 L 360,420 L 260,400 Z", center: { x: 32, y: 58 }, nodeCount: 8, activeNodes: 6 },
  { id: "eu", name: "Europe", path: "M 480,80 L 580,70 L 590,150 L 490,160 Z", center: { x: 54, y: 22 }, nodeCount: 15, activeNodes: 14 },
  { id: "af", name: "Africa", path: "M 480,170 L 560,180 L 540,350 L 470,320 Z", center: { x: 52, y: 45 }, nodeCount: 6, activeNodes: 5 },
  { id: "as", name: "Asia", path: "M 600,60 L 850,50 L 830,250 L 610,240 Z", center: { x: 72, y: 28 }, nodeCount: 22, activeNodes: 20 },
  { id: "oc", name: "Oceania", path: "M 750,300 L 900,280 L 880,400 L 740,390 Z", center: { x: 82, y: 58 }, nodeCount: 5, activeNodes: 5 },
];

function DemoContent() {
  const { theme, themeConfig, is3D, setIs3D } = useMapTheme();
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [showRegions, setShowRegions] = useState(true);

  return (
    <div 
      className="min-h-screen p-8 transition-colors duration-500"
      style={{ background: themeConfig.background }}
    >
      {/* Header */}
      <div className="flex justify-between items-start mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-2" style={{ color: themeConfig.text }}>
            Phase 3: Visual Styles
          </h1>
          <p className="text-white/60">Themes, 3D Globe, and Region Highlighting</p>
        </div>
        <ThemeToggle />
      </div>

      {/* Stats Row */}
      <div className="flex gap-4 mb-8">
        <StatWidget 
          label="Total Nodes" 
          value={mockNodes.length} 
          trend="up" 
          trendValue="15%" 
          color="cyan" 
        />
        <StatWidget 
          label="Active" 
          value={mockNodes.filter(n => n.isActive).length} 
          color="green" 
        />
        <StatWidget 
          label="Validators" 
          value={mockNodes.filter(n => n.isValidator).length} 
          color="purple" 
        />
        <StatWidget 
          label="Regions" 
          value={regions.length} 
          color="yellow" 
        />
      </div>

      {/* Demo Controls */}
      <div className="flex gap-4 mb-6">
        <button
          onClick={() => setIs3D(!is3D)}
          className="px-4 py-2 rounded-lg font-medium transition-all"
          style={{
            background: is3D ? `${themeConfig.accent}30` : "rgba(255,255,255,0.1)",
            border: `1px solid ${is3D ? themeConfig.accent : "rgba(255,255,255,0.2)"}`,
            color: is3D ? themeConfig.accent : themeConfig.text,
          }}
        >
          {is3D ? "🌐 3D Mode" : "🗺️ 2D Mode"}
        </button>
        
        <button
          onClick={() => setShowRegions(!showRegions)}
          className="px-4 py-2 rounded-lg font-medium transition-all"
          style={{
            background: showRegions ? `${themeConfig.accent}30` : "rgba(255,255,255,0.1)",
            border: `1px solid ${showRegions ? themeConfig.accent : "rgba(255,255,255,0.2)"}`,
            color: showRegions ? themeConfig.accent : themeConfig.text,
          }}
        >
          {showRegions ? "🌍 Show Regions" : "🌍 Hide Regions"}
        </button>
      </div>

      {/* Map Demo Area */}
      <GlassPanel className="relative w-full h-[500px] overflow-hidden" intensity="heavy">
        {/* Legend */}
        <div className="absolute top-4 left-4 z-10">
          <GlassPanel className="p-3" intensity="light">
            <div className="text-xs text-white/60 mb-2">Theme Colors</div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ background: themeConfig.marker.active }} />
                <span className="text-xs text-white/80">Active Node</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ background: themeConfig.marker.validator }} />
                <span className="text-xs text-white/80">Validator</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ background: themeConfig.marker.offline }} />
                <span className="text-xs text-white/80">Offline</span>
              </div>
            </div>
          </GlassPanel>
        </div>

        {/* 2D Map Content */}
        {!is3D && (
          <>
            {/* Region Highlight */}
            {showRegions && (
              <RegionHighlight
                regions={regions}
                selectedRegion={selectedRegion}
                onRegionClick={(r) => setSelectedRegion(r.id === selectedRegion ? null : r.id)}
              />
            )}

            {/* Region Pulse Effect */}
            <RegionPulse
              regions={[
                { id: "1", x: 25, y: 28, intensity: 0.8 },
                { id: "2", x: 72, y: 28, intensity: 1.0 },
                { id: "3", x: 54, y: 22, intensity: 0.9 },
              ]}
            />

            {/* Mock Node Markers (simplified) */}
            {mockNodes.map((node) => {
              // Convert lat/lon to simple x/y for demo
              const x = ((node.lon + 180) / 360) * 100;
              const y = ((90 - node.lat) / 180) * 100;
              
              return (
                <motion.div
                  key={node.id}
                  className="absolute w-3 h-3 rounded-full cursor-pointer"
                  style={{
                    left: `${x}%`,
                    top: `${y}%`,
                    transform: "translate(-50%, -50%)",
                    background: node.isValidator
                      ? themeConfig.marker.validator
                      : node.isActive
                      ? themeConfig.marker.active
                      : themeConfig.marker.offline,
                    boxShadow: node.isActive
                      ? `0 0 15px ${node.isValidator ? themeConfig.marker.validator : themeConfig.marker.active}`
                      : "none",
                  }}
                  whileHover={{ scale: 1.5 }}
                  animate={node.isActive ? {
                    scale: [1, 1.2, 1],
                  } : {}}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                />
              );
            })}
          </>
        )}

        {/* 3D Placeholder */}
        {is3D && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div 
                className="text-6xl mb-4"
                style={{ 
                  color: themeConfig.accent,
                  textShadow: `0 0 30px ${themeConfig.accent}`,
                }}
              >
                🌐
              </div>
              <p className="text-white/60">3D Globe View</p>
              <p className="text-white/40 text-sm mt-2">
                (Requires @react-three/fiber)
              </p>
              <div className="mt-4 text-xs text-white/30">
                Interactive rotation • Zoom • Node markers
              </div>
            </div>
          </div>
        )}
      </GlassPanel>

      {/* Features Grid */}
      <div className="grid grid-cols-3 gap-6 mt-8">
        <GlassPanel className="p-6">
          <h3 className="text-cyan-400 font-semibold mb-3">🎨 Theme System</h3>
          <ul className="text-white/70 text-sm space-y-2">
            <li>• 5 visual themes</li>
            <li>• Persistent via localStorage</li>
            <li>• CSS variable-based</li>
            <li>• Smooth transitions</li>
          </ul>
        </GlassPanel>

        <GlassPanel className="p-6">
          <h3 className="text-purple-400 font-semibold mb-3">🌐 3D Globe</h3>
          <ul className="text-white/70 text-sm space-y-2">
            <li>• Three.js powered</li>
            <li>• Atmosphere shader</li>
            <li>• Star background</li>
            <li>• Arc connections</li>
          </ul>
        </GlassPanel>

        <GlassPanel className="p-6">
          <h3 className="text-green-400 font-semibold mb-3">🌍 Regions</h3>
          <ul className="text-white/70 text-sm space-y-2">
            <li>• Animated borders</li>
            <li>• Click selection</li>
            <li>• Node count badges</li>
            <li>• Pulse effects</li>
          </ul>
        </GlassPanel>
      </div>

      {/* Current Theme Info */}
      <GlassPanel className="mt-8 p-6">
        <h3 className="text-white font-semibold mb-4">Current Theme: {themeConfig.name}</h3>
        <div className="grid grid-cols-5 gap-4">
          {Object.entries(themeConfig).filter(([k]) => k !== "name" && k !== "marker").map(([key, value]) => (
            <div key={key} className="text-center">
              <div className="text-xs text-white/40 uppercase mb-1">{key}</div>
              <div 
                className="w-12 h-12 rounded-lg mx-auto border border-white/10"
                style={{ 
                  background: typeof value === "string" && value.startsWith("#") 
                    ? value 
                    : "transparent",
                  borderColor: typeof value === "string" && value.startsWith("rgba")
                    ? value
                    : undefined,
                }}
              />
              <div className="text-xs text-white/60 mt-1 truncate">{String(value)}</div>
            </div>
          ))}
        </div>
      </GlassPanel>
    </div>
  );
}

export default function ThemeDemo() {
  return (
    <ThemeProvider defaultTheme="dark">
      <DemoContent />
    </ThemeProvider>
  );
}
