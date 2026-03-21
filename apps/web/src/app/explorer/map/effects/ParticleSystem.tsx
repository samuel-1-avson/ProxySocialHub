"use client";

/**
 * Particle System for Node Map
 * Creates flowing data particles around active nodes
 */

import React, { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface Particle {
  id: string;
  x: number;
  y: number;
  type: "upload" | "download" | "heartbeat" | "sparkle";
  size: number;
  duration: number;
  delay: number;
}

interface ParticleSystemProps {
  nodeId: string;
  isActive: boolean;
  isValidator: boolean;
  intensity?: "low" | "medium" | "high";
  centerX: number;
  centerY: number;
}

// Generate random particles
const generateParticles = (
  count: number,
  centerX: number,
  centerY: number,
  isValidator: boolean
): Particle[] => {
  const types: Particle["type"][] = isValidator
    ? ["upload", "download", "heartbeat", "sparkle", "sparkle"]
    : ["upload", "download", "heartbeat"];

  return Array.from({ length: count }, (_, i) => {
    const angle = (Math.random() * Math.PI * 2);
    const distance = 15 + Math.random() * 25;
    
    return {
      id: `${Date.now()}-${i}`,
      x: centerX + Math.cos(angle) * distance,
      y: centerY + Math.sin(angle) * distance,
      type: types[Math.floor(Math.random() * types.length)],
      size: 2 + Math.random() * 3,
      duration: 1.5 + Math.random() * 2,
      delay: Math.random() * 2,
    };
  });
};

// Get particle color based on type
const getParticleColor = (type: Particle["type"]): string => {
  switch (type) {
    case "upload":
      return "#00F5FF"; // Cyan
    case "download":
      return "#39FF14"; // Green
    case "heartbeat":
      return "#FFD700"; // Yellow
    case "sparkle":
      return "#B24DFF"; // Purple
    default:
      return "#00F5FF";
  }
};

// Get particle animation based on type
const getParticleAnimation = (type: Particle["type"], centerX: number, centerY: number) => {
  const angle = Math.random() * Math.PI * 2;
  const distance = 20 + Math.random() * 30;
  
  switch (type) {
    case "upload":
      // Float upward
      return {
        y: [centerY, centerY - 40],
        x: [centerX, centerX + (Math.random() - 0.5) * 20],
        opacity: [0, 1, 0],
        scale: [0.5, 1, 0.5],
      };
    case "download":
      // Float downward
      return {
        y: [centerY, centerY + 40],
        x: [centerX, centerX + (Math.random() - 0.5) * 20],
        opacity: [0, 1, 0],
        scale: [0.5, 1, 0.5],
      };
    case "heartbeat":
      // Pulse outward
      return {
        scale: [0.5, 1.5, 0.5],
        opacity: [0.8, 0, 0.8],
      };
    case "sparkle":
      // Twinkle effect
      return {
        scale: [0, 1, 0],
        opacity: [0, 1, 0],
        rotate: [0, 180, 360],
      };
    default:
      return {
        y: [centerY, centerY - 30],
        opacity: [0, 1, 0],
      };
  }
};

export function ParticleSystem({
  nodeId,
  isActive,
  isValidator,
  intensity = "medium",
  centerX,
  centerY,
}: ParticleSystemProps) {
  const [particles, setParticles] = useState<Particle[]>([]);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!isActive) {
      setParticles([]);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      return;
    }

    const particleCount = {
      low: 3,
      medium: 6,
      high: 10,
    }[intensity];

    // Initial particles
    setParticles(generateParticles(particleCount, centerX, centerY, isValidator));

    // Generate new particles periodically
    intervalRef.current = setInterval(() => {
      setParticles((prev) => {
        // Remove old particles
        const filtered = prev.slice(-particleCount);
        // Add new ones
        const newParticles = generateParticles(2, centerX, centerY, isValidator);
        return [...filtered, ...newParticles];
      });
    }, 800);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isActive, intensity, centerX, centerY, isValidator]);

  if (!isActive || particles.length === 0) return null;

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: centerX,
        top: centerY,
        width: 0,
        height: 0,
      }}
    >
      <AnimatePresence>
        {particles.map((particle) => (
          <motion.div
            key={particle.id}
            className="absolute rounded-full"
            style={{
              width: particle.size,
              height: particle.size,
              background: getParticleColor(particle.type),
              boxShadow: `0 0 ${particle.size * 2}px ${getParticleColor(particle.type)}`,
              left: -particle.size / 2,
              top: -particle.size / 2,
            }}
            initial={{ opacity: 0, scale: 0 }}
            animate={getParticleAnimation(particle.type, 0, 0)}
            exit={{ opacity: 0, scale: 0 }}
            transition={{
              duration: particle.duration,
              delay: particle.delay,
              ease: "easeOut",
            }}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

// Simplified particle burst for interactions
export function ParticleBurst({
  x,
  y,
  color = "#00F5FF",
  onComplete,
}: {
  x: number;
  y: number;
  color?: string;
  onComplete?: () => void;
}) {
  const particles = Array.from({ length: 8 }, (_, i) => ({
    id: i,
    angle: (i * 45 * Math.PI) / 180,
  }));

  return (
    <div
      className="absolute pointer-events-none"
      style={{ left: x, top: y }}
    >
      <AnimatePresence onExitComplete={onComplete}>
        {particles.map((particle) => (
          <motion.div
            key={particle.id}
            className="absolute w-1.5 h-1.5 rounded-full"
            style={{
              background: color,
              boxShadow: `0 0 6px ${color}`,
            }}
            initial={{ scale: 1, opacity: 1, x: 0, y: 0 }}
            animate={{
              x: Math.cos(particle.angle) * 30,
              y: Math.sin(particle.angle) * 30,
              opacity: 0,
              scale: 0,
            }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

export default ParticleSystem;
