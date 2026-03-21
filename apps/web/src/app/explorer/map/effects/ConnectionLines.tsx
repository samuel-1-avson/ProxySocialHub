"use client";

/**
 * Connection Lines Component
 * Visualizes data flow between nodes with animated SVG paths
 */

import React, { useMemo, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface NodePoint {
  id: string;
  x: number;
  y: number;
  isValidator: boolean;
  isActive: boolean;
}

interface Connection {
  id: string;
  source: NodePoint;
  target: NodePoint;
  strength: number;
  animated: boolean;
}

interface ConnectionLinesProps {
  nodes: NodePoint[];
  maxConnections?: number;
  connectionDistance?: number;
  showOnlyForSelected?: string | null;
}

// Calculate distance between two points
const getDistance = (a: NodePoint, b: NodePoint): number => {
  return Math.sqrt(Math.pow(b.x - a.x, 2) + Math.pow(b.y - a.y, 2));
};

// Generate curved path between two points
const createCurvedPath = (
  source: NodePoint,
  target: NodePoint,
  curvature: number = 0.2
): string => {
  const midX = (source.x + target.x) / 2;
  const midY = (source.y + target.y) / 2;
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const offset = Math.sqrt(dx * dx + dy * dy) * curvature;
  
  // Perpendicular offset for curve
  const cpX = midX - dy * (offset / Math.sqrt(dx * dx + dy * dy)) || midX;
  const cpY = midY + dx * (offset / Math.sqrt(dx * dx + dy * dy)) || midY;
  
  return `M ${source.x} ${source.y} Q ${cpX} ${cpY} ${target.x} ${target.y}`;
};

// Generate connections between nearby nodes
const generateConnections = (
  nodes: NodePoint[],
  maxConnections: number,
  maxDistance: number,
  selectedNodeId?: string | null
): Connection[] => {
  const connections: Connection[] = [];
  
  nodes.forEach((source, i) => {
    // If showing only for selected node, skip non-selected sources
    if (selectedNodeId && source.id !== selectedNodeId) return;
    
    // Find nearby nodes
    const nearby = nodes
      .slice(i + 1)
      .map((target) => ({
        target,
        distance: getDistance(source, target),
      }))
      .filter(({ distance }) => distance < maxDistance)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, maxConnections);
    
    nearby.forEach(({ target, distance }) => {
      const strength = 1 - distance / maxDistance;
      connections.push({
        id: `${source.id}-${target.id}`,
        source,
        target,
        strength,
        animated: source.isValidator || target.isValidator,
      });
    });
  });
  
  return connections;
};

// Animated data packet traveling along path
function DataPacket({
  path,
  duration,
  delay,
  color,
}: {
  path: string;
  duration: number;
  delay: number;
  color: string;
}) {
  return (
    <motion.circle
      r="3"
      fill={color}
      filter={`drop-shadow(0 0 4px ${color})`}
      initial={{ offsetDistance: "0%", opacity: 0 }}
      animate={{ offsetDistance: "100%", opacity: [0, 1, 1, 0] }}
      transition={{
        duration,
        delay,
        ease: "linear",
        repeat: Infinity,
        repeatDelay: duration,
      }}
    >
      <animateMotion
        dur={`${duration}s`}
        begin={`${delay}s`}
        repeatCount="indefinite"
        path={path}
      />
    </motion.circle>
  );
}

export function ConnectionLines({
  nodes,
  maxConnections = 3,
  connectionDistance = 200,
  showOnlyForSelected = null,
}: ConnectionLinesProps) {
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  
  useEffect(() => {
    // Get container dimensions
    const updateDimensions = () => {
      const container = document.getElementById("map-container");
      if (container) {
        setDimensions({
          width: container.clientWidth,
          height: container.clientHeight,
        });
      }
    };
    
    updateDimensions();
    window.addEventListener("resize", updateDimensions);
    return () => window.removeEventListener("resize", updateDimensions);
  }, []);
  
  const connections = useMemo(() => {
    return generateConnections(nodes, maxConnections, connectionDistance, showOnlyForSelected);
  }, [nodes, maxConnections, connectionDistance, showOnlyForSelected]);

  if (dimensions.width === 0) return null;

  return (
    <svg
      className="absolute inset-0 pointer-events-none z-[5]"
      width={dimensions.width}
      height={dimensions.height}
      style={{ overflow: "visible" }}
    >
      <defs>
        {/* Gradient for validator connections */}
        <linearGradient id="validator-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#00F5FF" stopOpacity="0.8" />
          <stop offset="50%" stopColor="#B24DFF" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#39FF14" stopOpacity="0.8" />
        </linearGradient>
        
        {/* Gradient for regular connections */}
        <linearGradient id="regular-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#00F5FF" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#00F5FF" stopOpacity="0.1" />
        </linearGradient>
        
        {/* Glow filter */}
        <filter id="line-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      
      <AnimatePresence>
        {connections.map((connection) => {
          const isValidatorConnection = connection.source.isValidator || connection.target.isValidator;
          const path = createCurvedPath(connection.source, connection.target, 0.15);
          const pathLength = getDistance(connection.source, connection.target);
          
          return (
            <g key={connection.id}>
              {/* Background line */}
              <motion.path
                d={path}
                fill="none"
                stroke={isValidatorConnection ? "rgba(0, 245, 255, 0.15)" : "rgba(0, 245, 255, 0.08)"}
                strokeWidth={isValidatorConnection ? 3 : 2}
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5 }}
              />
              
              {/* Animated glow line */}
              <motion.path
                d={path}
                fill="none"
                stroke={isValidatorConnection ? "url(#validator-gradient)" : "url(#regular-gradient)"}
                strokeWidth={isValidatorConnection ? 2 : 1}
                strokeDasharray={isValidatorConnection ? "0" : "5,5"}
                filter="url(#line-glow)"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{
                  pathLength: 1,
                  opacity: connection.strength * (isValidatorConnection ? 1 : 0.5),
                  strokeDashoffset: isValidatorConnection ? 0 : [0, -10],
                }}
                exit={{ opacity: 0 }}
                transition={{
                  pathLength: { duration: 0.5 },
                  opacity: { duration: 0.3 },
                  strokeDashoffset: isValidatorConnection ? {} : {
                    duration: 1,
                    repeat: Infinity,
                    ease: "linear",
                  },
                }}
              />
              
              {/* Data packets for validator connections */}
              {isValidatorConnection && (
                <>
                  <DataPacket
                    path={path}
                    duration={2}
                    delay={0}
                    color="#00F5FF"
                  />
                  <DataPacket
                    path={path}
                    duration={2}
                    delay={1}
                    color="#B24DFF"
                  />
                </>
              )}
            </g>
          );
        })}
      </AnimatePresence>
    </svg>
  );
}

// Simplified version for map background - shows network mesh
export function NetworkMesh({
  nodeCount = 20,
  className = "",
}: {
  nodeCount?: number;
  className?: string;
}) {
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  
  useEffect(() => {
    const updateDimensions = () => {
      setDimensions({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };
    
    updateDimensions();
    window.addEventListener("resize", updateDimensions);
    return () => window.removeEventListener("resize", updateDimensions);
  }, []);

  // Generate random background nodes
  const meshNodes = useMemo(() => {
    return Array.from({ length: nodeCount }, (_, i) => ({
      id: i,
      x: Math.random() * dimensions.width,
      y: Math.random() * dimensions.height,
    }));
  }, [nodeCount, dimensions]);

  // Generate connections
  const connections = useMemo(() => {
    const lines: { source: typeof meshNodes[0]; target: typeof meshNodes[0] }[] = [];
    
    meshNodes.forEach((source, i) => {
      meshNodes.slice(i + 1).forEach((target) => {
        const distance = Math.sqrt(
          Math.pow(target.x - source.x, 2) + Math.pow(target.y - source.y, 2)
        );
        if (distance < 150) {
          lines.push({ source, target });
        }
      });
    });
    
    return lines;
  }, [meshNodes]);

  if (dimensions.width === 0) return null;

  return (
    <svg
      className={`absolute inset-0 pointer-events-none ${className}`}
      width={dimensions.width}
      height={dimensions.height}
    >
      {connections.map((conn, i) => (
        <motion.line
          key={i}
          x1={conn.source.x}
          y1={conn.source.y}
          x2={conn.target.x}
          y2={conn.target.y}
          stroke="rgba(0, 245, 255, 0.03)"
          strokeWidth={1}
          initial={{ opacity: 0 }}
          animate={{ opacity: [0.03, 0.08, 0.03] }}
          transition={{
            duration: 3 + Math.random() * 2,
            repeat: Infinity,
            delay: Math.random() * 2,
          }}
        />
      ))}
      
      {meshNodes.map((node) => (
        <motion.circle
          key={node.id}
          cx={node.x}
          cy={node.y}
          r={1.5}
          fill="rgba(0, 245, 255, 0.1)"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0.1, 0.3, 0.1] }}
          transition={{
            duration: 2 + Math.random() * 2,
            repeat: Infinity,
            delay: Math.random() * 2,
          }}
        />
      ))}
    </svg>
  );
}

export default ConnectionLines;
