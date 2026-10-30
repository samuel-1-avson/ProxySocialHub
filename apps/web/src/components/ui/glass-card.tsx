'use client';

import { motion, HTMLMotionProps } from 'framer-motion';
import { cn } from '@/lib/utils';
import { forwardRef, type ReactNode } from 'react';

interface GlassCardProps extends Omit<HTMLMotionProps<'div'>, 'children'> {
    children?: ReactNode;
    variant?: 'default' | 'neo' | 'ghost';
    /** Kept for compatibility; cards no longer lift or glow on hover. */
    hoverEffect?: boolean;
}

/** Legacy card wrapper. Renders the same flat card as `ui/card`. */
export const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(
    ({ className, variant = 'default', hoverEffect = true, children, ...props }, ref) => {
        void hoverEffect;
        return (
            <motion.div
                ref={ref}
                className={cn(
                    'relative overflow-hidden rounded-lg border',
                    'bg-card border-border',
                    variant === 'neo' && 'border-primary/30 bg-primary/5',
                    variant === 'ghost' && 'bg-transparent border-transparent hover:bg-surface-hover',
                    className
                )}
                {...props}
            >
                <div className="relative p-6">{children}</div>
            </motion.div>
        );
    }
);

GlassCard.displayName = 'GlassCard';
