"use client";

/**
 * Phase 6 Demo: Final Polish
 * Transitions, skeletons, error boundaries, accessibility
 */

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ThemeProvider } from "../styles";
import { GlassPanel } from "../components/GlassPanel";
import { StatWidget } from "../stats/StatWidget";
import { PageTransition, StaggerContainer, StaggerItem, ViewSwitcher } from "../transitions";
import { Skeleton, CardSkeleton, StatSkeleton, PageLoader, MapLoadingOverlay } from "../loading";
import { ErrorBoundary, APIError, NetworkStatus } from "../error";
import { LiveRegionProvider, SkipLink, useAnnouncement, useReducedMotion } from "../accessibility";
import { usePerformanceMetrics, useVisibilityState } from "../utils";

function DemoContent() {
  const [activeTab, setActiveTab] = useState<"transitions" | "skeletons" | "errors" | "a11y" | "perf">("transitions");
  const [isLoading, setIsLoading] = useState(false);
  const [showError, setShowError] = useState(false);
  const [is3D, setIs3D] = useState(false);
  const { announce } = useAnnouncement();
  const prefersReducedMotion = useReducedMotion();
  const metrics = usePerformanceMetrics();
  const isVisible = useVisibilityState();

  // Announce tab changes
  useEffect(() => {
    announce(`Switched to ${activeTab} demo`, "polite");
  }, [activeTab, announce]);

  const handleLoadingDemo = () => {
    setIsLoading(true);
    setTimeout(() => setIsLoading(false), 3000);
  };

  const tabs = [
    { id: "transitions", label: "Transitions", icon: "✨" },
    { id: "skeletons", label: "Skeletons", icon: "💀" },
    { id: "errors", label: "Errors", icon: "⚠️" },
    { id: "a11y", label: "Accessibility", icon: "♿" },
    { id: "perf", label: "Performance", icon: "⚡" },
  ];

  return (
    <div className="min-h-screen bg-[#050508] p-8">
      <SkipLink targetId="main-content" />
      <NetworkStatus />

      <h1 className="text-3xl font-bold text-white mb-2">Phase 6: Final Polish</h1>
      <p className="text-white/60 mb-8">
        Transitions, loading states, error handling, accessibility, and performance optimizations
      </p>

      {/* Performance Monitor */}
      <GlassPanel className="mb-6 p-3 flex items-center gap-6 text-sm">
        <span className="text-white/40">Performance:</span>
        <span className={metrics.fps >= 55 ? "text-green-400" : metrics.fps >= 30 ? "text-yellow-400" : "text-red-400"}>
          {metrics.fps} FPS
        </span>
        <span className="text-white/40">|</span>
        <span className="text-purple-400">{metrics.memory} MB</span>
        <span className="text-white/40">|</span>
        <span className="text-cyan-400">{metrics.nodes} DOM nodes</span>
        <span className="text-white/40">|</span>
        <span className={isVisible ? "text-green-400" : "text-red-400"}>
          {isVisible ? "● Visible" : "○ Hidden"}
        </span>
        <span className="text-white/40">|</span>
        <span className="text-yellow-400">
          {prefersReducedMotion ? "🚫 Reduced Motion" : "✓ Animations On"}
        </span>
      </GlassPanel>

      {/* Tab Navigation */}
      <div className="flex gap-2 mb-8">
        {tabs.map((tab) => (
          <motion.button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.id
                ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                : "text-white/60 hover:text-white hover:bg-white/5"
            }`}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </motion.button>
        ))}
      </div>

      {/* Main Content */}
      <main id="main-content">
        <AnimatePresence mode="wait">
          {activeTab === "transitions" && (
            <motion.div
              key="transitions"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              <GlassPanel className="p-6">
                <h3 className="text-white font-semibold mb-4">View Switcher (2D/3D)</h3>
                <div className="flex items-center gap-4 mb-4">
                  <button
                    onClick={() => setIs3D(!is3D)}
                    className="px-4 py-2 rounded-lg bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                  >
                    Toggle View
                  </button>
                  <span className="text-white/60">Current: {is3D ? "3D" : "2D"}</span>
                </div>
                <div className="h-48 bg-black/50 rounded-lg overflow-hidden">
                  <ViewSwitcher
                    is3D={is3D}
                    view2D={
                      <div className="flex items-center justify-center h-full bg-gradient-to-br from-blue-900/50 to-cyan-900/50">
                        <span className="text-4xl">🗺️ 2D Map View</span>
                      </div>
                    }
                    view3D={
                      <div className="flex items-center justify-center h-full bg-gradient-to-br from-purple-900/50 to-pink-900/50">
                        <span className="text-4xl">🌐 3D Globe View</span>
                      </div>
                    }
                  />
                </div>
              </GlassPanel>

              <GlassPanel className="p-6">
                <h3 className="text-white font-semibold mb-4">Stagger Animation</h3>
                <StaggerContainer className="grid grid-cols-4 gap-4">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <StaggerItem key={i}>
                      <div className="p-4 bg-white/5 rounded-lg text-center">
                        <span className="text-2xl">{["✨", "🎨", "⚡", "🔥", "💎", "🚀", "🌟", "💫"][i]}</span>
                        <p className="text-white/60 text-sm mt-2">Item {i + 1}</p>
                      </div>
                    </StaggerItem>
                  ))}
                </StaggerContainer>
              </GlassPanel>
            </motion.div>
          )}

          {activeTab === "skeletons" && (
            <motion.div
              key="skeletons"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              <GlassPanel className="p-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-white font-semibold">Loading States</h3>
                  <button
                    onClick={handleLoadingDemo}
                    disabled={isLoading}
                    className="px-4 py-2 rounded-lg bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 disabled:opacity-50"
                  >
                    {isLoading ? "Loading..." : "Trigger Loading"}
                  </button>
                </div>

                {isLoading ? (
                  <MapLoadingOverlay progress={66} message="Loading node data..." />
                ) : (
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <p className="text-white/40 text-sm mb-3">Stat Skeletons</p>
                      <StatSkeleton count={3} />
                    </div>
                    <div>
                      <p className="text-white/40 text-sm mb-3">Card Skeleton</p>
                      <CardSkeleton lines={3} />
                    </div>
                  </div>
                )}
              </GlassPanel>

              <div className="grid grid-cols-3 gap-6">
                <GlassPanel className="p-4">
                  <p className="text-white/40 text-sm mb-3">Text Skeletons</p>
                  <Skeleton width="100%" height="1rem" className="mb-2" />
                  <Skeleton width="80%" height="1rem" className="mb-2" />
                  <Skeleton width="60%" height="1rem" />
                </GlassPanel>
                <GlassPanel className="p-4">
                  <p className="text-white/40 text-sm mb-3">Circle Skeletons</p>
                  <div className="flex gap-2">
                    <Skeleton width="40px" height="40px" rounded="full" />
                    <Skeleton width="40px" height="40px" rounded="full" />
                    <Skeleton width="40px" height="40px" rounded="full" />
                  </div>
                </GlassPanel>
                <GlassPanel className="p-4">
                  <p className="text-white/40 text-sm mb-3">Button Skeleton</p>
                  <Skeleton width="120px" height="36px" rounded="lg" />
                </GlassPanel>
              </div>
            </motion.div>
          )}

          {activeTab === "errors" && (
            <motion.div
              key="errors"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              <GlassPanel className="p-6">
                <h3 className="text-white font-semibold mb-4">Error States</h3>
                <div className="grid grid-cols-2 gap-6">
                  <div className="p-4 bg-white/5 rounded-lg">
                    <APIError statusCode={404} onRetry={() => setShowError(false)} />
                  </div>
                  <div className="p-4 bg-white/5 rounded-lg">
                    <APIError statusCode={500} onRetry={() => setShowError(false)} />
                  </div>
                  <div className="p-4 bg-white/5 rounded-lg">
                    <APIError statusCode={429} onRetry={() => setShowError(false)} />
                  </div>
                  <div className="p-4 bg-white/5 rounded-lg">
                    <APIError statusCode={503} onRetry={() => setShowError(false)} />
                  </div>
                </div>
              </GlassPanel>

              <GlassPanel className="p-6">
                <h3 className="text-white font-semibold mb-4">Error Boundary Demo</h3>
                <ErrorBoundary
                  fallback={
                    <div className="p-8 text-center text-red-400">
                      <p>🛡️ Error caught by boundary!</p>
                      <button
                        onClick={() => setShowError(false)}
                        className="mt-4 px-4 py-2 rounded-lg bg-white/10 text-white"
                      >
                        Reset
                      </button>
                    </div>
                  }
                >
                  {showError ? (
                    <ThrowError />
                  ) : (
                    <div className="text-center p-8">
                      <p className="text-white/60 mb-4">Component is working normally</p>
                      <button
                        onClick={() => setShowError(true)}
                        className="px-4 py-2 rounded-lg bg-red-500/20 text-red-400 border border-red-500/30"
                      >
                        Trigger Error
                      </button>
                    </div>
                  )}
                </ErrorBoundary>
              </GlassPanel>
            </motion.div>
          )}

          {activeTab === "a11y" && (
            <motion.div
              key="a11y"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              <GlassPanel className="p-6">
                <h3 className="text-white font-semibold mb-4">Accessibility Features</h3>
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <h4 className="text-white/80 font-medium">Keyboard Navigation</h4>
                    <p className="text-white/60 text-sm">
                      • Tab through all interactive elements<br />
                      • Escape closes modals and panels<br />
                      • Arrow keys for sliders and lists<br />
                      • Space/Enter activates buttons
                    </p>
                  </div>
                  <div className="space-y-4">
                    <h4 className="text-white/80 font-medium">Screen Reader Support</h4>
                    <p className="text-white/60 text-sm">
                      • ARIA labels on all controls<br />
                      • Live regions for announcements<br />
                      • Semantic HTML structure<br />
                      • Skip links for navigation
                    </p>
                  </div>
                  <div className="space-y-4">
                    <h4 className="text-white/80 font-medium">Visual Accessibility</h4>
                    <p className="text-white/60 text-sm">
                      • High contrast mode support<br />
                      • Focus indicators on all elements<br />
                      • Reduced motion preference<br />
                      • Color-blind friendly palettes
                    </p>
                  </div>
                  <div className="space-y-4">
                    <h4 className="text-white/80 font-medium">Focus Management</h4>
                    <p className="text-white/60 text-sm">
                      • Focus trap in modals<br />
                      • Return focus on close<br />
                      • Logical tab order<br />
                      • Visible focus states
                    </p>
                  </div>
                </div>
              </GlassPanel>

              <GlassPanel className="p-6">
                <h3 className="text-white font-semibold mb-4">Keyboard Shortcuts</h3>
                <div className="grid grid-cols-3 gap-4">
                  {[
                    { key: "Ctrl + K", action: "Open search" },
                    { key: "Ctrl + F", action: "Open filters" },
                    { key: "Esc", action: "Close panel/modal" },
                    { key: "?", action: "Show shortcuts" },
                    { key: "Tab", action: "Next element" },
                    { key: "Shift + Tab", action: "Previous element" },
                  ].map((shortcut, i) => (
                    <div key={i} className="flex items-center gap-3 p-3 bg-white/5 rounded-lg">
                      <kbd className="px-2 py-1 bg-white/10 rounded text-cyan-400 text-sm font-mono">
                        {shortcut.key}
                      </kbd>
                      <span className="text-white/60 text-sm">{shortcut.action}</span>
                    </div>
                  ))}
                </div>
              </GlassPanel>
            </motion.div>
          )}

          {activeTab === "perf" && (
            <motion.div
              key="perf"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              <GlassPanel className="p-6">
                <h3 className="text-white font-semibold mb-4">Performance Optimizations</h3>
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <h4 className="text-cyan-400 font-medium">✓ Implemented</h4>
                    <ul className="space-y-2 text-white/70 text-sm">
                      <li>• React.memo for static components</li>
                      <li>• useMemo for expensive calculations</li>
                      <li>• useCallback for event handlers</li>
                      <li>• Lazy loading for 3D globe</li>
                      <li>• Intersection Observer for visibility</li>
                      <li>• RAF loop for smooth animations</li>
                      <li>• Debounced search input</li>
                      <li>• Throttled scroll handlers</li>
                    </ul>
                  </div>
                  <div className="space-y-3">
                    <h4 className="text-purple-400 font-medium">⚡ Smart Features</h4>
                    <ul className="space-y-2 text-white/70 text-sm">
                      <li>• Pause animations when tab hidden</li>
                      <li>• Reduce quality on low FPS</li>
                      <li>• Virtual scrolling for lists</li>
                      <li>• Node clustering at zoom out</li>
                      <li>• Web Workers for heavy compute</li>
                      <li>• Image preloading</li>
                      <li>• Component code splitting</li>
                      <li>• Memory leak prevention</li>
                    </ul>
                  </div>
                </div>
              </GlassPanel>

              <div className="grid grid-cols-3 gap-6">
                <GlassPanel className="p-4 text-center">
                  <div className="text-3xl font-bold text-cyan-400">60</div>
                  <div className="text-white/60 text-sm">Target FPS</div>
                </GlassPanel>
                <GlassPanel className="p-4 text-center">
                  <div className="text-3xl font-bold text-purple-400">&lt;50</div>
                  <div className="text-white/60 text-sm">ms Response</div>
                </GlassPanel>
                <GlassPanel className="p-4 text-center">
                  <div className="text-3xl font-bold text-green-400">100+</div>
                  <div className="text-white/60 text-sm">Nodes Supported</div>
                </GlassPanel>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

// Helper component that throws an error
function ThrowError() {
  throw new Error("This is a demo error!");
}

export default function FinalDemo() {
  return (
    <ThemeProvider defaultTheme="dark">
      <LiveRegionProvider>
        <DemoContent />
      </LiveRegionProvider>
    </ThemeProvider>
  );
}
