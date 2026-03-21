"use client";

/**
 * Performance Utilities
 * Optimizations for better rendering and memory usage
 */

import { useMemo, useCallback, useRef, useEffect, useState } from "react";

// Debounce function
export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

// Throttle function
export function throttle<T extends (...args: unknown[]) => unknown>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;

  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

// Memoized selector hook
export function useMemoSelector<T, R>(
  data: T[],
  selector: (item: T) => R,
  deps: React.DependencyList = []
): R[] {
  return useMemo(() => data.map(selector), [data, ...deps]);
}

// Virtual list window calculator
interface VirtualWindow {
  startIndex: number;
  endIndex: number;
}

export function useVirtualWindow(
  itemCount: number,
  itemHeight: number,
  containerHeight: number,
  scrollTop: number,
  overscan = 5
): VirtualWindow {
  return useMemo(() => {
    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const visibleCount = Math.ceil(containerHeight / itemHeight);
    const endIndex = Math.min(itemCount, startIndex + visibleCount + overscan * 2);

    return { startIndex, endIndex };
  }, [itemCount, itemHeight, containerHeight, scrollTop, overscan]);
}

// Intersection Observer hook for lazy loading
export function useIntersectionObserver(
  options: IntersectionObserverInit = {}
): [(node: Element | null) => void, boolean] {
  const [isIntersecting, setIsIntersecting] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const setRef = useCallback((node: Element | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    if (node) {
      observerRef.current = new IntersectionObserver(([entry]) => {
        setIsIntersecting(entry.isIntersecting);
      }, options);

      observerRef.current.observe(node);
    }
  }, [options]);

  useEffect(() => {
    return () => observerRef.current?.disconnect();
  }, []);

  return [setRef, isIntersecting];
}

// RAF loop for smooth animations
export function useRAF(callback: (deltaTime: number) => void, isActive: boolean) {
  const callbackRef = useRef(callback);
  const rafIdRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!isActive) {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      return;
    }

    const loop = (time: number) => {
      if (lastTimeRef.current === 0) {
        lastTimeRef.current = time;
      }
      const deltaTime = time - lastTimeRef.current;
      lastTimeRef.current = time;

      callbackRef.current(deltaTime);
      rafIdRef.current = requestAnimationFrame(loop);
    };

    rafIdRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
      lastTimeRef.current = 0;
    };
  }, [isActive]);
}

// Visibility state hook (pause animations when tab hidden)
export function useVisibilityState(): boolean {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsVisible(!document.hidden);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  return isVisible;
}

// Performance metrics hook
export function usePerformanceMetrics() {
  const [metrics, setMetrics] = useState({
    fps: 0,
    memory: 0,
    nodes: 0,
  });

  useEffect(() => {
    let frameCount = 0;
    let lastTime = performance.now();

    const updateMetrics = () => {
      const now = performance.now();
      frameCount++;

      if (now - lastTime >= 1000) {
        const fps = Math.round((frameCount * 1000) / (now - lastTime));
        const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize || 0;

        setMetrics({
          fps,
          memory: Math.round(memory / 1024 / 1024), // MB
          nodes: document.querySelectorAll("*").length,
        });

        frameCount = 0;
        lastTime = now;
      }

      requestAnimationFrame(updateMetrics);
    };

    const id = requestAnimationFrame(updateMetrics);
    return () => cancelAnimationFrame(id);
  }, []);

  return metrics;
}

// Node clustering for performance
interface ClusterPoint {
  x: number;
  y: number;
  id: string;
  count: number;
}

export function clusterNodes(
  nodes: { id: string; x: number; y: number }[],
  radius: number
): ClusterPoint[] {
  const clusters: ClusterPoint[] = [];
  const visited = new Set<string>();

  nodes.forEach((node) => {
    if (visited.has(node.id)) return;

    const cluster: ClusterPoint = {
      x: node.x,
      y: node.y,
      id: node.id,
      count: 1,
    };

    nodes.forEach((other) => {
      if (other.id === node.id || visited.has(other.id)) return;

      const dist = Math.sqrt(
        Math.pow(node.x - other.x, 2) + Math.pow(node.y - other.y, 2)
      );

      if (dist < radius) {
        cluster.x = (cluster.x * cluster.count + other.x) / (cluster.count + 1);
        cluster.y = (cluster.y * cluster.count + other.y) / (cluster.count + 1);
        cluster.count++;
        visited.add(other.id);
      }
    });

    clusters.push(cluster);
    visited.add(node.id);
  });

  return clusters;
}

export default {
  debounce,
  throttle,
  useMemoSelector,
  useVirtualWindow,
  useIntersectionObserver,
  useRAF,
  useVisibilityState,
  usePerformanceMetrics,
  clusterNodes,
};
