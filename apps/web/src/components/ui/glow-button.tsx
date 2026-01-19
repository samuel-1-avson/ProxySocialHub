'use client';

import { motion, HTMLMotionProps } from 'framer-motion';
import { cn } from '@/lib/utils';
import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';

interface GlowButtonProps extends HTMLMotionProps<'button'> {
    variant?: 'primary' | 'secondary' | 'ghost' | 'outline';
    size?: 'sm' | 'md' | 'lg';
    loading?: boolean;
    icon?: React.ReactNode;
}

export const GlowButton = forwardRef<HTMLButtonElement, GlowButtonProps>(
    ({ className, variant = 'primary', size = 'md', loading, icon, children, ...props }, ref) => {
        const variants = {
            primary: 'bg-primary text-white shadow-[0_0_20px_-5px_var(--primary)] hover:shadow-[0_0_25px_-5px_var(--primary)] border-transparent',
            secondary: 'bg-secondary text-white hover:bg-secondary/90',
            outline: 'bg-transparent border-primary/20 text-primary hover:bg-primary/10 hover:border-primary/50',
            ghost: 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-white/5',
        };

        const sizes = {
            sm: 'px-3 py-1.5 text-xs',
            md: 'px-5 py-2.5 text-sm',
            lg: 'px-8 py-4 text-base font-bold',
        };

        return (
            <motion.button
                ref={ref}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className={cn(
                    'relative inline-flex items-center justify-center gap-2 rounded-xl transition-all duration-300 border',
                    variants[variant],
                    sizes[size],
                    loading && 'opacity-70 cursor-not-allowed',
                    className
                )}
                disabled={loading}
                {...props}
            >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                {!loading && icon && <span className="mr-1">{icon}</span>}
                {children}

                {variant === 'primary' && (
                    <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full hover:animate-shimmer pointer-events-none" />
                )}
            </motion.button>
        );
    }
);

GlowButton.displayName = 'GlowButton';
