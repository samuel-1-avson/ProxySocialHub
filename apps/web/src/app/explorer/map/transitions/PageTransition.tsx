"use client";

/**
 * Page Transition Component
 * Smooth transitions between map views
 */

import React from "react";
import { motion, AnimatePresence, Variants } from "framer-motion";

interface PageTransitionProps {
  children: React.ReactNode;
  mode?: "fade" | "slide" | "scale" | "glitch";
  duration?: number;
}

const transitions: Record<string, Variants> = {
  fade: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
  },
  slide: {
    initial: { opacity: 0, x: 20 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -20 },
  },
  scale: {
    initial: { opacity: 0, scale: 0.95 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 1.05 },
  },
  glitch: {
    initial: { 
      opacity: 0, 
      x: [-5, 5, -3, 0],
      filter: ["hue-rotate(90deg)", "hue-rotate(0deg)"],
    },
    animate: { 
      opacity: 1, 
      x: 0,
      filter: "hue-rotate(0deg)",
    },
    exit: { 
      opacity: 0,
      x: [0, 3, -5, 0],
      filter: ["hue-rotate(0deg)", "hue-rotate(-90deg)"],
    },
  },
};

export function PageTransition({ 
  children, 
  mode = "fade",
  duration = 0.3 
}: PageTransitionProps) {
  const variants = transitions[mode];

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={mode}
        variants={variants}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={{ 
          duration,
          ease: [0.25, 0.1, 0.25, 1],
        }}
        style={{ height: "100%" }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

// Stagger container for list items
interface StaggerContainerProps {
  children: React.ReactNode;
  staggerDelay?: number;
  className?: string;
}

export function StaggerContainer({ 
  children, 
  staggerDelay = 0.05,
  className = "" 
}: StaggerContainerProps) {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{
        hidden: { opacity: 0 },
        visible: {
          opacity: 1,
          transition: {
            staggerChildren: staggerDelay,
          },
        },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// Stagger item for use inside StaggerContainer
interface StaggerItemProps {
  children: React.ReactNode;
  className?: string;
}

export function StaggerItem({ children, className = "" }: StaggerItemProps) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 20 },
        visible: { 
          opacity: 1, 
          y: 0,
          transition: {
            type: "spring",
            stiffness: 300,
            damping: 24,
          },
        },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// Slide in from specific direction
interface SlideInProps {
  children: React.ReactNode;
  direction?: "left" | "right" | "top" | "bottom";
  distance?: number;
  delay?: number;
  className?: string;
}

export function SlideIn({ 
  children, 
  direction = "left",
  distance = 50,
  delay = 0,
  className = "" 
}: SlideInProps) {
  const directions = {
    left: { x: -distance, y: 0 },
    right: { x: distance, y: 0 },
    top: { x: 0, y: -distance },
    bottom: { x: 0, y: distance },
  };

  const { x, y } = directions[direction];

  return (
    <motion.div
      initial={{ opacity: 0, x, y }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={{
        delay,
        duration: 0.5,
        ease: [0.25, 0.1, 0.25, 1],
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// Fade in wrapper
interface FadeInProps {
  children: React.ReactNode;
  delay?: number;
  duration?: number;
  className?: string;
}

export function FadeIn({ 
  children, 
  delay = 0, 
  duration = 0.5,
  className = "" 
}: FadeInProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay, duration }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// Scale in with bounce
interface ScaleInProps {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}

export function ScaleIn({ children, delay = 0, className = "" }: ScaleInProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{
        delay,
        type: "spring",
        stiffness: 400,
        damping: 25,
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// View switcher animation (for 2D/3D toggle)
interface ViewSwitcherProps {
  is3D: boolean;
  view2D: React.ReactNode;
  view3D: React.ReactNode;
}

export function ViewSwitcher({ is3D, view2D, view3D }: ViewSwitcherProps) {
  return (
    <div className="relative w-full h-full overflow-hidden">
      <AnimatePresence mode="wait">
        {is3D ? (
          <motion.div
            key="3d"
            initial={{ opacity: 0, rotateY: -90 }}
            animate={{ opacity: 1, rotateY: 0 }}
            exit={{ opacity: 0, rotateY: 90 }}
            transition={{ duration: 0.5, ease: "easeInOut" }}
            style={{ 
              position: "absolute",
              inset: 0,
              transformPerspective: 1000,
            }}
          >
            {view3D}
          </motion.div>
        ) : (
          <motion.div
            key="2d"
            initial={{ opacity: 0, rotateY: 90 }}
            animate={{ opacity: 1, rotateY: 0 }}
            exit={{ opacity: 0, rotateY: -90 }}
            transition={{ duration: 0.5, ease: "easeInOut" }}
            style={{ 
              position: "absolute",
              inset: 0,
              transformPerspective: 1000,
            }}
          >
            {view2D}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default PageTransition;
