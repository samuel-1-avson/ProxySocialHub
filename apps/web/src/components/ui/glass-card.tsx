"use client";

import { motion, useReducedMotion, HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/utils";
import { forwardRef, type ReactNode } from "react";

interface GlassCardProps extends Omit<HTMLMotionProps<"div">, "children"> {
  children?: ReactNode;
  variant?: "default" | "neo" | "ghost";
  hoverEffect?: boolean;
}

export const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(
  (
    { className, variant = "default", hoverEffect = false, children, ...props },
    ref,
  ) => {
    const reducedMotion = useReducedMotion();
    return (
      <motion.div
        ref={ref}
        initial={false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        whileHover={
          hoverEffect && !reducedMotion
            ? { y: -2, transition: { duration: 0.2 } }
            : undefined
        }
        className={cn(
          "isolate relative overflow-hidden rounded-2xl border p-6 transition-colors duration-200",
          "bg-card border-border shadow-sm",
          variant === "neo" && "border-primary/30 bg-primary/5",
          variant === "ghost" &&
            "bg-transparent border-transparent shadow-none hover:bg-surface-hover",
          className,
        )}
        {...props}
      >
        {children}
      </motion.div>
    );
  },
);

GlassCard.displayName = "GlassCard";
