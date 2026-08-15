'use client';

import { motion, HTMLMotionProps } from 'framer-motion';
import { cn } from '@/lib/utils';
import { forwardRef, type ReactNode } from 'react';

interface GlassCardProps extends Omit<HTMLMotionProps<'div'>, 'children'> {
    children?: ReactNode;
    variant?: 'default' | 'neo' | 'ghost';
    hoverEffect?: boolean;
}

export const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(
    ({ className, variant = 'default', hoverEffect = true, children, ...props }, ref) => {
        return (
            <motion.div
                ref={ref}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
                whileHover={hoverEffect ? { y: -4, transition: { duration: 0.2 } } : undefined}
                className={cn(
                    'relative overflow-hidden rounded-2xl border transition-all duration-300',
                    'bg-card border-border shadow-sm',
                    variant === 'neo' && 'border-primary/30 bg-primary/5',
                    variant === 'ghost' && 'bg-transparent border-transparent shadow-none hover:bg-surface-hover',
                    className
                )}
                {...props}
            >
                {hoverEffect && (
                    <div className="absolute inset-0 opacity-0 hover:opacity-100 transition-opacity duration-500 pointer-events-none">
                        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent" />
                    </div>
                )}
                <div className="relative z-10 p-6">{children}</div>
            </motion.div>
        );
    }
);

GlassCard.displayName = 'GlassCard';
