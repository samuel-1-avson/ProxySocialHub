import React from "react";
import { cn } from "@/lib/utils";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "muted" | "interactive";
  hoverEffect?: boolean;
}

export const Card: React.FC<CardProps> = ({
  children,
  className = "",
  variant = "default",
  hoverEffect = false,
  ...props
}) => {
  const variants: Record<NonNullable<CardProps["variant"]>, string> = {
    default: "bg-[var(--card)] border border-[var(--border)] shadow-[var(--shadow-sm)]",
    muted: "bg-[var(--secondary)] border border-[var(--border)]",
    interactive:
      "bg-[var(--card)] border border-[var(--border)] shadow-[var(--shadow-sm)] hover:border-[var(--border-strong)] cursor-pointer",
  };

  return (
    <div
      className={cn(
        "rounded-[var(--radius-lg)] p-6 overflow-hidden",
        variants[variant],
        hoverEffect && "transition-colors duration-[var(--dur-fast)]",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};
