"use client";

/**
 * Enhanced Node Marker Component
 * Multi-layer design with animations, glow effects, and particle system
 */

import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  nodeEntryVariants,
  pulseRingVariants,
  haloRingVariants,
  markerHoverVariants,
  selectionVariants,
  corePulseVariants,
  tooltipVariants,
  getStatusColor,
  getStatusGlow,
} from "./MarkerAnimations";
import { ParticleSystem, ParticleBurst } from "../../effects";

interface NodeMarkerProps {
  node: {
    node_id: string;
    lat: number;
    lon: number;
    is_active: boolean;
    is_validator: boolean;
    uptime_percent: number;
    active_sessions: number;
    country: string;
    region: string;
    city?: string;
  };
  isSelected: boolean;
  onClick: () => void;
  index: number;
  mapX?: number;
  mapY?: number;
}

export function NodeMarker({ 
  node, 
  isSelected, 
  onClick, 
  index,
  mapX,
  mapY 
}: NodeMarkerProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [showBurst, setShowBurst] = useState(false);
  const [burstPosition, setBurstPosition] = useState({ x: 0, y: 0 });
  const markerRef = useRef<HTMLDivElement>(null);
  
  const status = node.is_active ? "active" : "offline";
  const color = getStatusColor(status, node.is_validator);
  const glow = getStatusGlow(status, node.is_validator);
  
  // Calculate animation delay based on index for staggered entry
  const entryDelay = index * 0.05;

  const handleClick = (e: React.MouseEvent) => {
    // Get click position for particle burst
    const rect = markerRef.current?.getBoundingClientRect();
    if (rect) {
      setBurstPosition({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
      setShowBurst(true);
    }
    onClick();
  };

  // Determine particle intensity based on node activity
  const getParticleIntensity = () => {
    if (!node.is_active) return "low";
    if (node.is_validator) return "high";
    if (node.active_sessions > 0) return "medium";
    return "low";
  };

  return (
    <motion.div
      ref={markerRef}
      className="absolute cursor-pointer"
      style={{
        left: `${node.lon}%`,
        top: `${node.lat}%`,
        transform: "translate(-50%, -50%)",
      }}
      initial="hidden"
      animate="visible"
      exit="exit"
      custom={entryDelay}
      variants={nodeEntryVariants}
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Particle System for active nodes */}
      {node.is_active && mapX !== undefined && mapY !== undefined && (
        <ParticleSystem
          nodeId={node.node_id}
          isActive={node.is_active}
          isValidator={node.is_validator}
          intensity={getParticleIntensity()}
          centerX={mapX}
          centerY={mapY}
        />
      )}

      {/* Click burst effect */}
      {showBurst && (
        <ParticleBurst
          x={burstPosition.x}
          y={burstPosition.y}
          color={color}
          onComplete={() => setShowBurst(false)}
        />
      )}

      {/* Layer 4: Outer Pulse Ring */}
      {node.is_active && (
        <motion.div
          className="absolute rounded-full pointer-events-none"
          style={{
            width: 48,
            height: 48,
            left: -16,
            top: -16,
            border: `2px solid ${color}`,
            boxShadow: glow,
          }}
          variants={pulseRingVariants}
          animate="animate"
        />
      )}

      {/* Layer 3: Rotating Halo Ring */}
      <motion.div
        className="absolute rounded-full pointer-events-none"
        style={{
          width: 32,
          height: 32,
          left: -8,
          top: -8,
          background: `conic-gradient(from 0deg, transparent, ${color}40, transparent, ${color}20, transparent)`,
          opacity: 0.6,
        }}
        variants={haloRingVariants}
        animate="animate"
      />

      {/* Layer 2: Core Ring */}
      <motion.div
        className="absolute rounded-full pointer-events-none"
        style={{
          width: 24,
          height: 24,
          left: -4,
          top: -4,
          border: `2px solid ${color}`,
          boxShadow: glow,
          background: "rgba(0, 0, 0, 0.3)",
        }}
        animate={isSelected ? "selected" : isHovered ? "hover" : "rest"}
        variants={selectionVariants}
        whileHover="hover"
      />

      {/* Layer 1: Center Dot */}
      <motion.div
        className="absolute rounded-full pointer-events-none"
        style={{
          width: 12,
          height: 12,
          left: 2,
          top: 2,
          background: color,
          boxShadow: glow,
        }}
        variants={corePulseVariants}
        custom={node.is_active}
        animate="animate"
      />

      {/* Tooltip */}
      <AnimatePresence>
        {isHovered && (
          <motion.div
            className="absolute z-50 pointer-events-none"
            style={{
              bottom: 20,
              left: "50%",
              transform: "translateX(-50%)",
            }}
            initial="hidden"
            animate="visible"
            exit="hidden"
            variants={tooltipVariants}
          >
            <div
              className="px-3 py-2 rounded-lg whitespace-nowrap"
              style={{
                background: "rgba(10, 10, 15, 0.9)",
                backdropFilter: "blur(10px)",
                border: `1px solid ${color}40`,
                boxShadow: `0 4px 20px ${color}30`,
              }}
            >
              <div className="text-xs font-semibold" style={{ color }}>
                {node.city || node.country}
              </div>
              <div className="text-xs text-white/60 mt-1">
                {node.is_active ? "● Online" : "○ Offline"}
                {node.is_validator && " ★ Validator"}
              </div>
              <div className="text-xs text-white/40 mt-1">
                {node.uptime_percent.toFixed(1)}% uptime
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Selected indicator ring */}
      {isSelected && (
        <motion.div
          className="absolute rounded-full pointer-events-none"
          style={{
            width: 40,
            height: 40,
            left: -12,
            top: -12,
            border: "2px solid #FF2D9E",
            boxShadow: "0 0 20px rgba(255, 45, 158, 0.5)",
          }}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0, opacity: 0 }}
        />
      )}
    </motion.div>
  );
}

export default NodeMarker;
