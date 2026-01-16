import React from "react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: "primary" | "secondary" | "outline" | "ghost" | "danger";
    size?: "sm" | "md" | "lg";
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
    const baseStyles = "inline-flex items-center justify-center font-medium transition-all duration-200 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed";

    const variants = {
        primary: "bg-[var(--primary)] text-white hover:bg-[var(--primary-dark)] shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-md)] hover:-translate-y-0.5",
        secondary: "bg-[var(--secondary)] text-white hover:bg-[var(--secondary-light)] hover:-translate-y-0.5",
        outline: "border-2 border-[var(--primary)] text-[var(--primary)] bg-transparent hover:bg-[var(--primary)] hover:text-white",
        ghost: "bg-transparent text-[var(--foreground)] hover:bg-black/5 dark:hover:bg-white/5",
        danger: "bg-[var(--error)] text-white hover:opacity-90",
    };

    const sizes = {
        sm: "text-sm px-3 py-1.5 rounded-[var(--radius-sm)]",
        md: "text-base px-5 py-2.5 rounded-[var(--radius)]",
        lg: "text-lg px-8 py-3 rounded-[var(--radius-lg)]",
    };

    return (
        <button
            className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
            disabled={isLoading || props.disabled}
            {...props}
        >
            {isLoading ? (
                <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white"></span>
            ) : null}
            {children}
        </button>
    );
};
