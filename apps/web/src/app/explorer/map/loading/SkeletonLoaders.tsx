"use client";

/**
 * Skeleton Loader Components
 * Loading states for better perceived performance
 */

import React from "react";
import { motion, type Variants } from "framer-motion";

// Shimmer animation for skeletons
const shimmerVariants = {
  animate: {
    backgroundPosition: ["200% 0", "-200% 0"],
    transition: {
      duration: 1.5,
      repeat: Infinity,
      ease: "linear" as const,
    },
  },
} satisfies Variants;

// Base skeleton with shimmer effect
interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  className?: string;
  rounded?: "none" | "sm" | "md" | "lg" | "full";
}

export function Skeleton({ 
  width = "100%", 
  height = "1rem",
  className = "",
  rounded = "md"
}: SkeletonProps) {
  const roundedClasses = {
    none: "rounded-none",
    sm: "rounded-sm",
    md: "rounded-md",
    lg: "rounded-lg",
    full: "rounded-full",
  };

  return (
    <motion.div
      variants={shimmerVariants}
      animate="animate"
      className={`bg-gradient-to-r from-white/5 via-white/10 to-white/5 ${roundedClasses[rounded]} ${className}`}
      style={{
        width,
        height,
        backgroundSize: "200% 100%",
      }}
    />
  );
}

// Card skeleton
interface CardSkeletonProps {
  lines?: number;
  hasImage?: boolean;
  className?: string;
}

export function CardSkeleton({ 
  lines = 3, 
  hasImage = false,
  className = "" 
}: CardSkeletonProps) {
  return (
    <div className={`p-4 bg-white/5 border border-white/10 rounded-lg ${className}`}>
      {hasImage && (
        <Skeleton width="100%" height="120px" rounded="lg" className="mb-4" />
      )}
      <Skeleton width="60%" height="1.25rem" rounded="md" className="mb-3" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton 
          key={i}
          width={i === lines - 1 ? "40%" : "100%"}
          height="0.875rem"
          rounded="sm"
          className="mb-2"
        />
      ))}
    </div>
  );
}

// Stat widget skeleton
export function StatSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div 
          key={i}
          className="px-6 py-4 bg-white/5 border border-white/10 rounded-lg min-w-[140px]"
        >
          <Skeleton width="50%" height="0.75rem" rounded="sm" className="mb-2" />
          <Skeleton width="70%" height="1.75rem" rounded="md" />
        </div>
      ))}
    </div>
  );
}

// Node marker skeleton (for map loading)
export function NodeMarkerSkeleton({ count = 5 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <motion.div
          key={i}
          className="absolute"
          style={{
            left: `${20 + Math.random() * 60}%`,
            top: `${20 + Math.random() * 60}%`,
          }}
          initial={{ opacity: 0, scale: 0 }}
          animate={{ 
            opacity: [0.3, 0.6, 0.3],
            scale: 1,
          }}
          transition={{
            opacity: {
              duration: 1.5,
              repeat: Infinity,
              delay: i * 0.1,
            },
            scale: {
              duration: 0.3,
              delay: i * 0.05,
            },
          }}
        >
          <div className="w-4 h-4 rounded-full bg-cyan-500/30 animate-pulse" />
        </motion.div>
      ))}
    </>
  );
}

// Details panel skeleton
export function DetailsPanelSkeleton() {
  return (
    <div className="w-[420px] bg-black/80 backdrop-blur-xl border border-white/10 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b border-white/10">
        <Skeleton width="50%" height="1.5rem" rounded="md" className="mb-2" />
        <Skeleton width="30%" height="0.875rem" rounded="sm" />
      </div>

      {/* Tabs */}
      <div className="px-6 py-4 border-b border-white/10">
        <div className="flex gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} width="80px" height="36px" rounded="lg" />
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="p-6 space-y-6">
        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="p-4 bg-white/5 rounded-lg">
              <Skeleton width="40%" height="0.75rem" rounded="sm" className="mb-2" />
              <Skeleton width="60%" height="1.5rem" rounded="md" />
            </div>
          ))}
        </div>

        {/* Progress bars */}
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i}>
              <div className="flex justify-between mb-2">
                <Skeleton width="30%" height="0.875rem" rounded="sm" />
                <Skeleton width="15%" height="0.875rem" rounded="sm" />
              </div>
              <Skeleton width="100%" height="8px" rounded="full" />
            </div>
          ))}
        </div>

        {/* Chart area */}
        <Skeleton width="100%" height="200px" rounded="lg" />
      </div>
    </div>
  );
}

// Activity feed skeleton
export function ActivityFeedSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="w-80 bg-black/80 backdrop-blur-xl border border-white/10 rounded-lg overflow-hidden">
      <div className="p-4 border-b border-white/10">
        <Skeleton width="40%" height="1.25rem" rounded="md" />
      </div>
      <div className="p-2">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-3">
            <Skeleton width="40px" height="40px" rounded="full" />
            <div className="flex-1">
              <Skeleton width="60%" height="0.875rem" rounded="sm" className="mb-2" />
              <Skeleton width="40%" height="0.75rem" rounded="sm" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Map loading overlay
interface MapLoadingOverlayProps {
  message?: string;
  progress?: number;
}

export function MapLoadingOverlay({ 
  message = "Loading map data...",
  progress 
}: MapLoadingOverlayProps) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#050508]/95 backdrop-blur-sm z-50">
      {/* Spinner */}
      <div className="relative mb-6">
        <motion.div
          className="w-16 h-16 border-2 border-cyan-500/20 border-t-cyan-500 rounded-full"
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        />
        <motion.div
          className="absolute inset-2 border-2 border-purple-500/20 border-t-purple-500 rounded-full"
          animate={{ rotate: -360 }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
        />
      </div>

      {/* Message */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="text-cyan-400 text-lg font-medium mb-4"
      >
        {message}
      </motion.p>

      {/* Progress bar */}
      {progress !== undefined && (
        <div className="w-64 h-2 bg-white/10 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-gradient-to-r from-cyan-500 to-purple-500"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
      )}

      {/* Loading dots */}
      <div className="flex gap-1 mt-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <motion.div
            key={i}
            className="w-2 h-2 rounded-full bg-cyan-500"
            animate={{ 
              opacity: [0.3, 1, 0.3],
              scale: [0.8, 1, 0.8],
            }}
            transition={{
              duration: 1,
              repeat: Infinity,
              delay: i * 0.2,
            }}
          />
        ))}
      </div>
    </div>
  );
}

// Full page loader
export function PageLoader() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-[#050508] z-50">
      <div className="text-center">
        {/* Logo animation */}
        <motion.div
          className="text-6xl mb-6"
          animate={{ 
            scale: [1, 1.1, 1],
            rotate: [0, 5, -5, 0],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        >
          🌐
        </motion.div>

        {/* Text */}
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-2xl font-bold text-white mb-2"
        >
          ProxyHubb
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.6 }}
          transition={{ delay: 0.2 }}
          className="text-white/60"
        >
          Loading node explorer...
        </motion.p>

        {/* Progress dots */}
        <div className="flex justify-center gap-2 mt-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <motion.div
              key={i}
              className="w-3 h-3 rounded-full bg-gradient-to-r from-cyan-500 to-purple-500"
              animate={{ 
                y: [0, -10, 0],
                opacity: [0.5, 1, 0.5],
              }}
              transition={{
                duration: 0.6,
                repeat: Infinity,
                delay: i * 0.15,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// Export all
export default {
  Skeleton,
  CardSkeleton,
  StatSkeleton,
  NodeMarkerSkeleton,
  DetailsPanelSkeleton,
  ActivityFeedSkeleton,
  MapLoadingOverlay,
  PageLoader,
};
