"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Interactive network pulse — Quiet Infrastructure.
 * Canvas-based node mesh with subtle pointer interaction.
 */
export function NetworkPulse() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    setReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    if (reducedMotion) return;

    const canvasEl = canvasRef.current;
    if (!canvasEl) return;

    const context = canvasEl.getContext("2d");
    if (!context) return;

    const canvas: HTMLCanvasElement = canvasEl;
    const ctx: CanvasRenderingContext2D = context;

    let raf = 0;
    let width = 0;
    let height = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    const pointer = { x: -1000, y: -1000 };

    function resize() {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    resize();
    window.addEventListener("resize", resize);

    const N = 28;
    const nodes = Array.from({ length: N }, (_, i) => ({
      x: Math.random(),
      y: Math.random(),
      vx: (Math.random() - 0.5) * 0.0004,
      vy: (Math.random() - 0.5) * 0.0004,
      r: 1.5 + Math.random() * 2,
      phase: Math.random() * Math.PI * 2,
    }));

    const edges: Array<[number, number]> = [];
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        if (Math.hypot(dx, dy) < 0.22) edges.push([i, j]);
      }
    }

    function tick(t: number) {
      ctx.clearRect(0, 0, width, height);

      const primary = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() || "#34d399";
      const border = getComputedStyle(document.documentElement).getPropertyValue("--border-strong").trim() || "#3a4354";

      // Update nodes
      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0.05 || n.x > 0.95) n.vx *= -1;
        if (n.y < 0.05 || n.y > 0.95) n.vy *= -1;

        // Pointer repulsion
        const px = pointer.x / width;
        const py = pointer.y / height;
        const dx = n.x - px;
        const dy = n.y - py;
        const dist = Math.hypot(dx, dy);
        if (dist < 0.12 && dist > 0.001) {
          const force = (0.12 - dist) * 0.0008;
          n.vx += (dx / dist) * force;
          n.vy += (dy / dist) * force;
        }
      }

      // Draw edges
      ctx.strokeStyle = border;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.35;
      for (const [a, b] of edges) {
        const na = nodes[a];
        const nb = nodes[b];
        const x1 = na.x * width;
        const y1 = na.y * height;
        const x2 = nb.x * width;
        const y2 = nb.y * height;
        const d = Math.hypot(x2 - x1, y2 - y1);
        if (d < 180) {
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
      }

      // Draw nodes with pulse
      ctx.globalAlpha = 1;
      for (const n of nodes) {
        const x = n.x * width;
        const y = n.y * height;
        const pulse = 0.5 + 0.5 * Math.sin(t * 0.0012 + n.phase);
        const r = n.r + pulse * 1.5;

        ctx.beginPath();
        ctx.arc(x, y, r + 6, 0, Math.PI * 2);
        ctx.fillStyle = primary;
        ctx.globalAlpha = 0.08 + pulse * 0.06;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = primary;
        ctx.globalAlpha = 0.7 + pulse * 0.3;
        ctx.fill();
      }

      raf = requestAnimationFrame(tick);
    }

    raf = requestAnimationFrame(tick);

    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = e.clientX - rect.left;
      pointer.y = e.clientY - rect.top;
    };
    const onLeave = () => {
      pointer.x = -1000;
      pointer.y = -1000;
    };

    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
    };
  }, [reducedMotion]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 h-full w-full"
      aria-hidden
    />
  );
}
