import React from "react";
import { cn } from "@/lib/utils";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "secondary" | "outline" | "ghost" | "danger" | "link";
  size?: "sm" | "md" | "lg" | "icon";
  isLoading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  className = "",
  variant = "primary",
  size = "md",
  isLoading = false,
  ...props
}) => {
  const baseStyles =
    "inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] disabled:opacity-50 disabled:cursor-not-allowed";

  const variants: Record<NonNullable<ButtonProps["variant"]>, string> = {
    default:
      "bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-[var(--primary-dark)]",
    primary:
      "bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-[var(--primary-dark)]",
    secondary:
      "bg-[var(--secondary)] text-[var(--secondary-foreground)] hover:bg-[var(--secondary-light)] border border-[var(--border)]",
    outline:
      "border border-[var(--border-strong)] text-[var(--foreground)] bg-transparent hover:bg-[var(--secondary)]",
    ghost: "bg-transparent text-[var(--foreground)] hover:bg-[var(--secondary)]",
    danger:
      "bg-[var(--destructive)] text-[var(--destructive-foreground)] hover:opacity-90",
    link: "bg-transparent text-[var(--primary)] underline-offset-4 hover:underline h-auto px-0 py-0 border-0 shadow-none",
  };

  const sizes: Record<NonNullable<ButtonProps["size"]>, string> = {
    sm: "text-sm px-3 py-1.5 rounded-[var(--radius-sm)]",
    md: "text-sm px-4 py-2 rounded-[var(--radius-md)]",
    lg: "text-base px-6 py-2.5 rounded-[var(--radius-md)]",
    icon: "h-10 w-10 rounded-[var(--radius-md)] p-0",
  };

  return (
    <button
      className={cn(baseStyles, variants[variant], sizes[size], className)}
      disabled={isLoading || props.disabled}
      aria-busy={isLoading || undefined}
      {...props}
    >
      {isLoading ? (
        <span
          className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current/20 border-t-current"
          aria-hidden
        />
      ) : null}
      {children}
    </button>
  );
};
