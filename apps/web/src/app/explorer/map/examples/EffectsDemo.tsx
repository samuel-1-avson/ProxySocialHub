"use client";

/**
 * Effects Demo Page
 * Showcases all Phase 2 visual effects
 */

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GlassPanel } from "../components/GlassPanel";
import { StatWidget } from "../stats/StatWidget";
import { ParticleSystem, ParticleBurst, ConnectionLines, NetworkMesh } from "../effects";

// Mock nodes for demo
const mockNodes = [
  { id: "1", x: 200, y: 200, isValidator: true, isActive: true },
  { id: "2", x: 350, y: 250, isValidator: false, isActive: true },
  { id: "3", x: 400, y: 150, isValidator: false, isActive: true },
  { id: "4", x: 300, y: 350, isValidator: false, isActive: false },
  { id: "5", x: 500, y: 280, isValidator: true, isActive: true },
];

export default function EffectsDemo() {
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [burst, setBurst] = useState<{ x: number; y: number; id: string } | null>(null);

  const handleClick = (e: React.MouseEvent, nodeId: string) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setBurst({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      id: `${Date.now()}`,
    });
    setSelectedNode(nodeId);
  };

  return (
    <div className="min-h-screen bg-[#050508] p-8">
      <h1 className="text-3xl font-bold text-white mb-8">Phase 2: Effects Demo</h1>

      {/* Stats Row */}
      <div className="flex gap-4 mb-8">
        <StatWidget label="Active Nodes" value={4} trend="up" trendValue="20%" color="cyan" />
        <StatWidget label="Validators" value={2} trend="neutral" color="purple" />
        <StatWidget label="Total Traffic" value={128.5} suffix="TB" trend="up" trendValue="12%" color="green" />
      </div>

      {/* Demo Area */}
      <GlassPanel className="relative w-full h-[600px] overflow-hidden" intensity="heavy">
        <h2 className="text-white/80 text-lg mb-4">Click nodes to see burst effects & connections</h2>
        
        {/* Network Mesh Background */}
        <NetworkMesh nodeCount={12} />
        
        {/* Connection Lines */}
        <ConnectionLines
          nodes={mockNodes}
          maxConnections={3}
          connectionDistance={250}
          showOnlyForSelected={selectedNode}
        />

        {/* Mock Nodes */}
        {mockNodes.map((node) => (
          <div
            key={node.id}
            className="absolute"
            style={{ left: node.x, top: node.y }}
          >
            {/* Particle System */}
            <ParticleSystem
              nodeId={node.id}
              isActive={node.isActive}
              isValidator={node.isValidator}
              intensity={node.isValidator ? "high" : "medium"}
              centerX={0}
              centerY={0}
            />

            {/* Clickable Marker */}
            <motion.div
              className={`relative w-4 h-4 rounded-full cursor-pointer ${
                node.isActive
                  ? node.isValidator
                    ? "bg-purple-400"
                    : "bg-cyan-400"
                  : "bg-gray-600"
              }`}
              whileHover={{ scale: 1.5 }}
              whileTap={{ scale: 0.9 }}
              onClick={(e) => handleClick(e, node.id)}
              style={{
                boxShadow: node.isActive
                  ? `0 0 20px ${node.isValidator ? "#B24DFF" : "#00F5FF"}`
                  : "none",
              }}
            >
              {/* Pulse ring for active nodes */}
              {node.isActive && (
                <motion.div
                  className="absolute inset-0 rounded-full"
                  style={{
                    border: `2px solid ${node.isValidator ? "#B24DFF" : "#00F5FF"}`,
                  }}
                  animate={{
                    scale: [1, 1.5, 1],
                    opacity: [0.8, 0, 0.8],
                  }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                />
              )}

              {/* Selection indicator */}
              {selectedNode === node.id && (
                <motion.div
                  className="absolute -inset-2 rounded-full border-2 border-pink-500"
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  style={{
                    boxShadow: "0 0 20px rgba(255, 45, 158, 0.5)",
                  }}
                />
              )}
            </motion.div>

            {/* Label */}
            <div className="absolute top-6 left-1/2 -translate-x-1/2 text-white/60 text-xs whitespace-nowrap">
              Node {node.id}
              {node.isValidator && " ★"}
            </div>
          </div>
        ))}

        {/* Particle Burst on click */}
        <AnimatePresence>
          {burst && (
            <div
              className="absolute pointer-events-none"
              style={{ left: burst.x, top: burst.y }}
            >
              <ParticleBurst
                x={0}
                y={0}
                color="#00F5FF"
                onComplete={() => setBurst(null)}
              />
            </div>
          )}
        </AnimatePresence>
      </GlassPanel>

      {/* Features List */}
      <div className="grid grid-cols-2 gap-6 mt-8">
        <GlassPanel className="p-6">
          <h3 className="text-cyan-400 font-semibold mb-3">Particle System</h3>
          <ul className="text-white/70 text-sm space-y-2">
            <li>• Upload particles (cyan) - float upward</li>
            <li>• Download particles (green) - float downward</li>
            <li>• Heartbeat (yellow) - pulsing dots</li>
            <li>• Sparkle (purple) - for validators</li>
            <li>• Intensity levels: low/medium/high</li>
          </ul>
        </GlassPanel>

        <GlassPanel className="p-6">
          <h3 className="text-purple-400 font-semibold mb-3">Connection Lines</h3>
          <ul className="text-white/70 text-sm space-y-2">
            <li>• Curved SVG paths between nodes</li>
            <li>• Animated data packets traveling</li>
            <li>• Gradient effects for validators</li>
            <li>• Strength-based opacity</li>
            <li>• Dashed animation for regular nodes</li>
          </ul>
        </GlassPanel>
      </div>
    </div>
  );
}
