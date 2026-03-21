"use client";

/**
 * Error Boundary Component
 * Catch and display errors gracefully
 */

import React, { Component, ReactNode } from "react";
import { motion } from "framer-motion";
import { GlassPanel } from "../components/GlassPanel";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Error caught by boundary:", error, errorInfo);
    this.setState({ error, errorInfo });

    // Could send to error reporting service here
    // reportError(error, errorInfo);
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

      return (
        <ErrorFallback
          error={this.state.error}
          onReset={this.handleReset}
        />
      );
    }

    return this.props.children;
  }
}

// Error fallback UI
interface ErrorFallbackProps {
  error: Error | null;
  onReset: () => void;
}

function ErrorFallback({ error, onReset }: ErrorFallbackProps) {
  const [showDetails, setShowDetails] = React.useState(false);

  return (
    <div className="min-h-screen bg-[#050508] flex items-center justify-center p-8">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
      >
        <GlassPanel intensity="heavy" className="max-w-lg p-8 text-center">
          {/* Error Icon */}
          <motion.div
            initial={{ rotate: 0 }}
            animate={{ rotate: [0, -10, 10, -10, 10, 0] }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-6xl mb-4"
          >
            ⚠️
          </motion.div>

          {/* Title */}
          <h1 className="text-2xl font-bold text-white mb-2">
            Something went wrong
          </h1>
          <p className="text-white/60 mb-6">
            We apologize for the inconvenience. An unexpected error has occurred.
          </p>

          {/* Error Message */}
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-6">
            <p className="text-red-400 font-mono text-sm">
              {error?.message || "Unknown error"}
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-3 justify-center">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={onReset}
              className="px-6 py-3 rounded-lg bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 font-medium hover:bg-cyan-500/30 transition-colors"
            >
              Try Again
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => window.location.reload()}
              className="px-6 py-3 rounded-lg bg-white/5 border border-white/10 text-white/80 font-medium hover:bg-white/10 transition-colors"
            >
              Reload Page
            </motion.button>
          </div>

          {/* Details Toggle */}
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="mt-6 text-white/40 text-sm hover:text-white/60 transition-colors"
          >
            {showDetails ? "Hide Details ▲" : "Show Details ▼"}
          </button>

          {/* Stack Trace */}
          {showDetails && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-4 p-4 bg-black/50 rounded-lg overflow-auto max-h-48 text-left"
            >
              <pre className="text-xs text-white/40 font-mono whitespace-pre-wrap">
                {error?.stack}
              </pre>
            </motion.div>
          )}
        </GlassPanel>
      </motion.div>
    </div>
  );
}

// Map-specific error fallback
export function MapErrorFallback({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[#050508]/95 backdrop-blur-sm z-50">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <GlassPanel intensity="heavy" className="p-8 text-center max-w-md">
          <div className="text-5xl mb-4">🗺️💥</div>
          <h2 className="text-xl font-bold text-white mb-2">
            Failed to load map
          </h2>
          <p className="text-white/60 text-sm mb-6">
            We couldn&apos;t load the node map data. This might be a network issue.
          </p>
          <div className="flex gap-3 justify-center">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={onRetry}
              className="px-5 py-2.5 rounded-lg bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 font-medium hover:bg-cyan-500/30 transition-colors"
            >
              Retry
            </motion.button>
          </div>
        </GlassPanel>
      </motion.div>
    </div>
  );
}

// API Error Component
interface APIErrorProps {
  statusCode?: number;
  message?: string;
  onRetry?: () => void;
}

export function APIError({ statusCode = 500, message, onRetry }: APIErrorProps) {
  const errors: Record<number, { title: string; description: string; icon: string }> = {
    404: {
      title: "Not Found",
      description: "The requested resource could not be found.",
      icon: "🔍",
    },
    429: {
      title: "Rate Limited",
      description: "Too many requests. Please wait a moment and try again.",
      icon: "⏱️",
    },
    500: {
      title: "Server Error",
      description: "An internal server error occurred. Please try again later.",
      icon: "🔧",
    },
    503: {
      title: "Service Unavailable",
      description: "The service is temporarily unavailable. Please try again later.",
      icon: "🔌",
    },
  };

  const error = errors[statusCode] || errors[500];

  return (
    <div className="flex flex-col items-center justify-center p-8 text-center">
      <div className="text-5xl mb-4">{error.icon}</div>
      <h3 className="text-lg font-semibold text-white mb-2">
        {statusCode} - {error.title}
      </h3>
      <p className="text-white/60 text-sm mb-4 max-w-sm">
        {message || error.description}
      </p>
      {onRetry && (
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={onRetry}
          className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white/80 text-sm hover:bg-white/10 transition-colors"
        >
          Try Again
        </motion.button>
      )}
    </div>
  );
}

// Network Status Indicator
export function NetworkStatus() {
  const [isOnline, setIsOnline] = React.useState(true);

  React.useEffect(() => {
    setIsOnline(navigator.onLine);

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -50 }}
      className="fixed top-4 left-1/2 -translate-x-1/2 z-[100]"
    >
      <div className="px-4 py-2 bg-red-500/20 border border-red-500/30 rounded-full flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        <span className="text-red-400 text-sm font-medium">
          You are offline
        </span>
      </div>
    </motion.div>
  );
}

export default ErrorBoundary;
