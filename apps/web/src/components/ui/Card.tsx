import React from "react";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
    variant?: "default" | "retro";
    hoverEffect?: boolean;
}

export const Card: React.FC<CardProps> = ({
    children,
    className = "",
    variant = "default",
    hoverEffect = false,
    ...props
}) => {
    const baseStyles = "bg-[var(--card)] border border-[var(--card-border)] rounded-[var(--radius)] p-6 overflow-hidden";

    const variants = {
        default: "shadow-[var(--shadow-sm)]",
        retro: "shadow-[var(--shadow-retro)] border-2 border-[var(--foreground)]",
    };

    const hoverStyles = hoverEffect
        ? "transition-all duration-200 hover:-translate-y-1 hover:shadow-lg"
        : "";

    return (
        <div
            className={`${baseStyles} ${variants[variant]} ${hoverStyles} ${className}`}
            {...props}
        >
            {children}
        </div>
    );
};
