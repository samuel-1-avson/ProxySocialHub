'use client';

import React, { Component, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import Link from 'next/link';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
    onReset?: () => void;
    level?: 'page' | 'section' | 'component';
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: React.ErrorInfo | null;
}

/**
 * Error Boundary component for graceful error handling
 * Use at page, section, or component level for different fallback behaviors
 */
export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(error: Error): Partial<State> {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        this.setState({ errorInfo });

        // Log to console in development
        if (process.env.NODE_ENV === 'development') {
            console.error('ErrorBoundary caught:', error, errorInfo);
        }

        // TODO: Send to error tracking service (Sentry, etc.)
    }

    handleReset = () => {
        this.setState({ hasError: false, error: null, errorInfo: null });
        this.props.onReset?.();
    };

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            const { level = 'section' } = this.props;

            // Component-level: minimal inline error
            if (level === 'component') {
                return (
                    <div className="flex items-center gap-2 text-destructive text-sm p-2 bg-destructive/10 rounded-sm border border-destructive/20">
                        <AlertTriangle size={14} />
                        <span>Failed to load</span>
                        <button
                            onClick={this.handleReset}
                            className="ml-auto text-xs underline hover:no-underline"
                        >
                            Retry
                        </button>
                    </div>
                );
            }

            // Section-level: medium error card
            if (level === 'section') {
                return (
                    <div className="card-retro p-6 bg-card border-destructive/30">
                        <div className="flex items-start gap-4">
                            <div className="p-3 rounded-sm bg-destructive/10 text-destructive">
                                <AlertTriangle size={24} />
                            </div>
                            <div className="flex-1">
                                <h3 className="font-bold font-mono text-lg mb-1">Something went wrong</h3>
                                <p className="text-sm text-muted-foreground mb-4">
                                    This section failed to load. Try refreshing or come back later.
                                </p>
                                {process.env.NODE_ENV === 'development' && this.state.error && (
                                    <pre className="text-xs bg-secondary p-2 rounded-sm overflow-auto max-h-32 mb-4 font-mono">
                                        {this.state.error.message}
                                    </pre>
                                )}
                                <button
                                    onClick={this.handleReset}
                                    className="btn-retro btn-retro-outline py-2 px-4 text-xs flex items-center gap-2"
                                >
                                    <RefreshCw size={14} /> Try Again
                                </button>
                            </div>
                        </div>
                    </div>
                );
            }

            // Page-level: full error page
            return (
                <div className="min-h-[60vh] flex items-center justify-center p-8">
                    <div className="max-w-md text-center">
                        <div className="w-20 h-20 mx-auto mb-6 rounded-sm bg-destructive/10 text-destructive flex items-center justify-center">
                            <AlertTriangle size={40} />
                        </div>
                        <h1 className="text-3xl font-bold font-mono mb-2">SYSTEM ERROR</h1>
                        <p className="text-muted-foreground mb-6">
                            An unexpected error occurred. Our team has been notified.
                        </p>
                        {process.env.NODE_ENV === 'development' && this.state.error && (
                            <details className="text-left mb-6">
                                <summary className="cursor-pointer text-xs font-mono text-muted-foreground hover:text-foreground">
                                    View error details
                                </summary>
                                <pre className="text-xs bg-secondary p-3 rounded-sm overflow-auto max-h-48 mt-2 font-mono">
                                    {this.state.error.stack || this.state.error.message}
                                </pre>
                            </details>
                        )}
                        <div className="flex gap-4 justify-center">
                            <button
                                onClick={this.handleReset}
                                className="btn-retro btn-retro-primary py-3 px-6 flex items-center gap-2"
                            >
                                <RefreshCw size={16} /> Try Again
                            </button>
                            <Link href="/dashboard" className="btn-retro btn-retro-outline py-3 px-6 flex items-center gap-2">
                                <Home size={16} /> Go Home
                            </Link>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

/**
 * HOC to wrap any component with error boundary
 */
export function withErrorBoundary<P extends object>(
    WrappedComponent: React.ComponentType<P>,
    level: 'page' | 'section' | 'component' = 'section'
) {
    return function WithErrorBoundary(props: P) {
        return (
            <ErrorBoundary level={level}>
                <WrappedComponent {...props} />
            </ErrorBoundary>
        );
    };
}

export default ErrorBoundary;
