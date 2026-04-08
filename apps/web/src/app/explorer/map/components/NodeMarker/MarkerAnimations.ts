/**
 * Node Marker Animation Variants
 * Using Framer Motion format
 */

import type { Variants } from "framer-motion";

// Entry animation when node appears on map
export const nodeEntryVariants = {
  hidden: {
    scale: 0,
    opacity: 0,
    filter: "blur(10px)",
  },
  visible: (delay: number = 0) => ({
    scale: 1,
    opacity: 1,
    filter: "blur(0px)",
    transition: {
      type: "spring" as const,
      stiffness: 400,
      damping: 15,
      delay: delay,
    },
  }),
  exit: {
    scale: 0,
    opacity: 0,
    filter: "blur(10px)",
    transition: {
      duration: 0.3,
      ease: [0.4, 0, 0.2, 1] as const,
    },
  },
} satisfies Variants;

// Continuous pulse animation for active nodes
export const pulseRingVariants = {
  animate: {
    scale: [1, 1.5, 1],
    opacity: [0.6, 0, 0.6],
    transition: {
      duration: 2,
      ease: "easeInOut",
      repeat: Infinity,
    },
  },
} satisfies Variants;

// Rotating halo effect
export const haloRingVariants = {
  animate: {
    rotate: [0, 360],
    transition: {
      duration: 8,
      ease: "linear",
      repeat: Infinity,
    },
  },
} satisfies Variants;

// Hover interaction
export const markerHoverVariants = {
  rest: {
    scale: 1,
    transition: {
      duration: 0.2,
      ease: [0.4, 0, 0.2, 1] as const,
    },
  },
  hover: {
    scale: 1.3,
    transition: {
      type: "spring" as const,
      stiffness: 400,
      damping: 10,
    },
  },
} satisfies Variants;

// Selection state
export const selectionVariants = {
  unselected: {
    scale: 1,
    boxShadow: "0 0 0 0 rgba(255, 45, 158, 0)",
    transition: {
      duration: 0.2,
    },
  },
  selected: {
    scale: 1.4,
    boxShadow: [
      "0 0 0 0 rgba(255, 45, 158, 0.4)",
      "0 0 20px 5px rgba(255, 45, 158, 0.3)",
      "0 0 0 0 rgba(255, 45, 158, 0.4)",
    ],
    transition: {
      scale: {
        type: "spring" as const,
        stiffness: 500,
        damping: 20,
      },
      boxShadow: {
        duration: 1.5,
        repeat: Infinity,
        ease: "easeInOut",
      },
    },
  },
} satisfies Variants;

// Core dot pulse
export const corePulseVariants = {
  animate: (isActive: boolean) => ({
    scale: isActive ? [1, 1.2, 1] : 1,
    opacity: isActive ? [1, 0.8, 1] : 0.6,
    transition: {
      duration: 1.5,
      ease: "easeInOut",
      repeat: isActive ? Infinity : 0,
    },
  }),
} satisfies Variants;

// Tooltip animation
export const tooltipVariants = {
  hidden: {
    opacity: 0,
    y: 10,
    scale: 0.95,
    transition: {
      duration: 0.15,
    },
  },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      type: "spring" as const,
      stiffness: 300,
      damping: 20,
    },
  },
} satisfies Variants;

// Status-based colors
export const getStatusColor = (status: string, isValidator: boolean = false): string => {
  if (isValidator) return "#B24DFF";
  
  switch (status) {
    case "online":
    case "active":
      return "#00F5FF";
    case "offline":
      return "#FF4444";
    case "degraded":
      return "#FFD700";
    default:
      return "#00F5FF";
  }
};

// Status-based glow
export const getStatusGlow = (status: string, isValidator: boolean = false): string => {
  if (isValidator) return "0 0 20px rgba(178, 77, 255, 0.5)";
  
  switch (status) {
    case "online":
    case "active":
      return "0 0 20px rgba(0, 245, 255, 0.5)";
    case "offline":
      return "0 0 10px rgba(255, 68, 68, 0.3)";
    default:
      return "0 0 20px rgba(0, 245, 255, 0.5)";
  }
};
