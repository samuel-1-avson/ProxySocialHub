"use client";

/**
 * 3D Globe View Component
 * Interactive Three.js globe with node markers
 */

import React, { useRef, useMemo, useEffect, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Stars, Html } from "@react-three/drei";
import * as THREE from "three";
import { motion } from "framer-motion";
import { useMapTheme, globeColors } from "../styles/ThemeProvider";

interface NodeData {
  id: string;
  lat: number;
  lon: number;
  isActive: boolean;
  isValidator: boolean;
  city?: string;
  country?: string;
}

interface GlobeViewProps {
  nodes: NodeData[];
  selectedNodeId?: string | null;
  onNodeClick?: (node: NodeData) => void;
  width?: number;
  height?: number;
}

// Convert lat/lon to 3D position on sphere
function latLonToVector3(lat: number, lon: number, radius: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  
  const x = -(radius * Math.sin(phi) * Math.cos(theta));
  const z = radius * Math.sin(phi) * Math.sin(theta);
  const y = radius * Math.cos(phi);
  
  return new THREE.Vector3(x, y, z);
}

// Atmosphere shader material
function Atmosphere({ radius, color }: { radius: number; color: string }) {
  const meshRef = useRef<THREE.Mesh>(null);
  
  const vertexShader = `
    varying vec3 vNormal;
    void main() {
      vNormal = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;
  
  const fragmentShader = `
    varying vec3 vNormal;
    uniform vec3 glowColor;
    void main() {
      float intensity = pow(0.6 - dot(vNormal, vec3(0, 0, 1.0)), 4.0);
      gl_FragColor = vec4(glowColor, 1.0) * intensity;
    }
  `;
  
  return (
    <mesh ref={meshRef} scale={[1.2, 1.2, 1.2]}>
      <sphereGeometry args={[radius, 64, 64]} />
      <shaderMaterial
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={{
          glowColor: { value: new THREE.Color(color) },
        }}
        blending={THREE.AdditiveBlending}
        side={THREE.BackSide}
        transparent
      />
    </mesh>
  );
}

// Earth sphere with texture
function Earth({ radius, theme }: { radius: number; theme: string }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const { themeConfig } = useMapTheme();
  const colors = globeColors[theme as keyof typeof globeColors] || globeColors.dark;
  
  useFrame(({ clock }) => {
    if (meshRef.current) {
      meshRef.current.rotation.y = clock.getElapsedTime() * 0.05;
    }
  });
  
  // Create procedural earth texture using canvas
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext("2d")!;
    
    // Ocean background
    ctx.fillStyle = colors.ocean;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Simple continent shapes (procedural)
    ctx.fillStyle = colors.land;
    for (let i = 0; i < 50; i++) {
      const x = Math.random() * canvas.width;
      const y = Math.random() * canvas.height;
      const size = 30 + Math.random() * 80;
      
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }
    
    // Grid lines
    ctx.strokeStyle = `${colors.emissive}20`;
    ctx.lineWidth = 1;
    
    // Latitude lines
    for (let i = 0; i < 9; i++) {
      const y = (canvas.height / 10) * (i + 1);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }
    
    // Longitude lines
    for (let i = 0; i < 19; i++) {
      const x = (canvas.width / 20) * (i + 1);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    
    const tex = new THREE.CanvasTexture(canvas);
    return tex;
  }, [colors]);
  
  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[radius, 64, 64]} />
      <meshPhongMaterial
        map={texture}
        emissive={colors.emissive}
        emissiveIntensity={0.1}
        specular={new THREE.Color(colors.emissive)}
        shininess={10}
      />
    </mesh>
  );
}

// Node marker on globe
function NodeMarker({
  node,
  radius,
  isSelected,
  onClick,
}: {
  node: NodeData;
  radius: number;
  isSelected: boolean;
  onClick: () => void;
}) {
  const position = useMemo(
    () => latLonToVector3(node.lat, node.lon, radius),
    [node.lat, node.lon, radius]
  );
  
  const { themeConfig } = useMapTheme();
  const color = node.isValidator
    ? themeConfig.marker.validator
    : node.isActive
    ? themeConfig.marker.active
    : themeConfig.marker.offline;
  
  const groupRef = useRef<THREE.Group>(null);
  
  useFrame(({ clock }) => {
    if (groupRef.current && node.isActive) {
      const scale = 1 + Math.sin(clock.getElapsedTime() * 3) * 0.1;
      groupRef.current.scale.setScalar(scale);
    }
  });
  
  return (
    <group ref={groupRef} position={position}>
      {/* Glow ring */}
      {node.isActive && (
        <mesh>
          <ringGeometry args={[0.04, 0.06, 32]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.6}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
      
      {/* Core dot */}
      <mesh onClick={onClick}>
        <sphereGeometry args={[0.02, 16, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={isSelected ? 2 : 0.5}
        />
      </mesh>
      
      {/* Selection indicator */}
      {isSelected && (
        <mesh>
          <ringGeometry args={[0.08, 0.09, 32]} />
          <meshBasicMaterial
            color={themeConfig.marker.selected}
            transparent
            opacity={0.8}
          />
        </mesh>
      )}
      
      {/* Tooltip HTML */}
      {isSelected && (
        <Html distanceFactor={10}>
          <div className="bg-black/80 backdrop-blur-sm px-3 py-2 rounded-lg border border-cyan-500/30 whitespace-nowrap">
            <div className="text-cyan-400 text-sm font-semibold">
              {node.city || node.country}
            </div>
            <div className="text-white/60 text-xs">
              {node.isActive ? "● Online" : "○ Offline"}
              {node.isValidator && " ★ Validator"}
            </div>
          </div>
        </Html>
      )}
    </group>
  );
}

// Connection lines between nodes
function ConnectionLines({
  nodes,
  radius,
}: {
  nodes: NodeData[];
  radius: number;
}) {
  const { themeConfig } = useMapTheme();
  
  const lines = useMemo(() => {
    const connections: { start: THREE.Vector3; end: THREE.Vector3 }[] = [];
    const activeNodes = nodes.filter((n) => n.isActive);
    
    activeNodes.forEach((source, i) => {
      activeNodes.slice(i + 1).forEach((target) => {
        const dist = Math.sqrt(
          Math.pow(source.lat - target.lat, 2) + 
          Math.pow(source.lon - target.lon, 2)
        );
        
        if (dist < 60) {
          connections.push({
            start: latLonToVector3(source.lat, source.lon, radius),
            end: latLonToVector3(target.lat, target.lon, radius),
          });
        }
      });
    });
    
    return connections;
  }, [nodes, radius]);
  
  return (
    <>
      {lines.map((line, i) => {
        // Create curved arc between points
        const midPoint = line.start.clone().add(line.end).multiplyScalar(0.5);
        midPoint.setLength(radius * 1.2);
        
        const curve = new THREE.QuadraticBezierCurve3(line.start, midPoint, line.end);
        const points = curve.getPoints(50);
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({
          color: themeConfig.accent,
          transparent: true,
          opacity: 0.3,
        });
        
        return (
          <primitive key={i} object={new THREE.Line(geometry, material)} />
        );
      })}
    </>
  );
}

// Main globe scene
function GlobeScene({
  nodes,
  selectedNodeId,
  onNodeClick,
}: {
  nodes: NodeData[];
  selectedNodeId?: string | null;
  onNodeClick?: (node: NodeData) => void;
}) {
  const { theme } = useMapTheme();
  const radius = 2;
  const colors = globeColors[theme];
  
  return (
    <>
      {/* Ambient light */}
      <ambientLight intensity={0.3} />
      
      {/* Directional light (sun) */}
      <directionalLight position={[5, 3, 5]} intensity={1} />
      
      {/* Stars background */}
      <Stars
        radius={100}
        depth={50}
        count={5000}
        factor={4}
        saturation={0}
        fade
        speed={1}
      />
      
      {/* Atmosphere glow */}
      <Atmosphere radius={radius} color={colors.atmosphere} />
      
      {/* Earth */}
      <Earth radius={radius} theme={theme} />
      
      {/* Connection lines */}
      <ConnectionLines nodes={nodes} radius={radius * 1.01} />
      
      {/* Node markers */}
      {nodes.map((node) => (
        <NodeMarker
          key={node.id}
          node={node}
          radius={radius * 1.02}
          isSelected={selectedNodeId === node.id}
          onClick={() => onNodeClick?.(node)}
        />
      ))}
      
      {/* Orbit controls */}
      <OrbitControls
        enablePan={false}
        enableZoom={true}
        minDistance={3}
        maxDistance={10}
        autoRotate
        autoRotateSpeed={0.5}
      />
    </>
  );
}

export function GlobeView({
  nodes,
  selectedNodeId,
  onNodeClick,
  width = 800,
  height = 600,
}: GlobeViewProps) {
  const [isLoading, setIsLoading] = useState(true);
  
  return (
    <div className="relative" style={{ width, height }}>
      {/* Loading state */}
      {isLoading && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 flex items-center justify-center bg-[#050508] z-10"
        >
          <div className="text-center">
            <div className="w-12 h-12 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-cyan-400 text-sm">Loading 3D Globe...</p>
          </div>
        </motion.div>
      )}
      
      {/* 3D Canvas */}
      <Canvas
        camera={{ position: [0, 0, 5], fov: 45 }}
        onCreated={() => setIsLoading(false)}
        style={{ background: "transparent" }}
      >
        <GlobeScene
          nodes={nodes}
          selectedNodeId={selectedNodeId}
          onNodeClick={onNodeClick}
        />
      </Canvas>
      
      {/* Controls hint */}
      <div className="absolute bottom-4 left-4 text-white/40 text-xs">
        <p>🖱️ Drag to rotate • 🖱️ Scroll to zoom</p>
      </div>
    </div>
  );
}

export default GlobeView;
