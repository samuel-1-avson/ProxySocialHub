/**
 * Global network topology — Quiet Infrastructure.
 * Server component: no JS. Abstract world mesh with edge routing.
 */
export function LandingHeroVisual() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_30%,rgba(52,211,153,0.08),transparent_60%)]" />
      <div className="absolute inset-0 opacity-[0.25] [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_70%)]" />

      <svg
        className="absolute inset-x-0 bottom-0 top-20 mx-auto h-[min(75vh,680px)] w-full max-w-6xl opacity-70"
        viewBox="0 0 1000 460"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="ph-edge" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0" />
            <stop offset="50%" stopColor="var(--primary)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
          </linearGradient>
          <filter id="ph-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* World mesh arcs */}
        <g stroke="var(--border-strong)" strokeWidth="0.75" opacity="0.5">
          <ellipse cx="500" cy="230" rx="420" ry="180" />
          <ellipse cx="500" cy="230" rx="420" ry="120" />
          <ellipse cx="500" cy="230" rx="420" ry="60" />
          <ellipse cx="500" cy="230" rx="180" ry="180" />
          <ellipse cx="500" cy="230" rx="120" ry="180" />
          <ellipse cx="500" cy="230" rx="60" ry="180" />
        </g>

        {/* Node clusters */}
        {[
          { cx: 180, cy: 180, r: 4, label: "EU" },
          { cx: 320, cy: 120, r: 4, label: "NA-E" },
          { cx: 680, cy: 140, r: 4, label: "APAC" },
          { cx: 820, cy: 220, r: 4, label: "SA" },
          { cx: 500, cy: 90, r: 5, label: "EDGE" },
          { cx: 240, cy: 320, r: 4, label: "AF" },
          { cx: 760, cy: 340, r: 4, label: "OC" },
        ].map((n) => (
          <g key={n.label}>
            <circle cx={n.cx} cy={n.cy} r={n.r + 8} fill="var(--primary)" opacity="0.15" filter="url(#ph-glow)" />
            <circle cx={n.cx} cy={n.cy} r={n.r} fill="var(--primary)" />
            <text
              x={n.cx}
              y={n.cy + 24}
              textAnchor="middle"
              fill="var(--muted-foreground)"
              style={{ fontSize: 10, fontFamily: "ui-monospace, monospace" }}
            >
              {n.label}
            </text>
          </g>
        ))}

        {/* Active routes */}
        <g stroke="url(#ph-edge)" strokeWidth="1.5" strokeLinecap="round">
          <path d="M180 180 Q 340 120 500 90" />
          <path d="M320 120 Q 410 105 500 90" />
          <path d="M680 140 Q 590 115 500 90" />
          <path d="M820 220 Q 660 155 500 90" />
          <path d="M240 320 Q 370 205 500 90" />
          <path d="M760 340 Q 630 215 500 90" />
        </g>

        {/* Buyer session */}
        <rect x="80" y="200" width="120" height="60" rx="6" fill="var(--card)" stroke="var(--border-strong)" strokeWidth="1.5" />
        <text x="140" y="226" textAnchor="middle" fill="var(--muted-foreground)" style={{ fontSize: 10, fontFamily: "ui-monospace, monospace" }}>
          BUYER
        </text>
        <text x="140" y="246" textAnchor="middle" fill="var(--foreground)" style={{ fontSize: 12, fontFamily: "ui-monospace, monospace", fontWeight: 600 }}>
          session
        </text>
        <path d="M200 230 H 460" stroke="url(#ph-edge)" strokeWidth="2" strokeDasharray="4 6" />
      </svg>
    </div>
  );
}
