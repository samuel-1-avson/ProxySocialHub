import { ArrowDownRight, ArrowUpRight, Globe2 } from "lucide-react";

const nodes = [
  { x: 99, y: 160, label: "BUYER", detail: "request" },
  { x: 270, y: 73, label: "EDGE", detail: "gateway" },
  { x: 438, y: 160, label: "SUPPLY", detail: "provider" },
];

export function LandingHeroVisual() {
  return (
    <figure className="landing-topology">
      <div className="landing-topology-heading">
        <div>
          <p className="landing-visual-kicker">NETWORK / REQUEST PATH</p>
          <h2>One clear route through.</h2>
        </div>
        <span className="landing-topology-icon" aria-hidden="true"><Globe2 size={19} /></span>
      </div>

      <svg
        className="landing-topology-map"
        viewBox="0 0 540 250"
        role="img"
        aria-label="Illustration of a buyer request passing through an edge gateway to a provider node"
      >
        <defs>
          <linearGradient id="path-signal" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="var(--primary)" stopOpacity="0.22" />
            <stop offset="0.5" stopColor="var(--primary)" />
            <stop offset="1" stopColor="var(--primary)" stopOpacity="0.22" />
          </linearGradient>
          <pattern id="topology-grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M24 0H0V24" fill="none" stroke="var(--border)" strokeWidth="0.55" opacity="0.72" />
          </pattern>
          <filter id="node-halo" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
        </defs>
        <rect width="540" height="250" rx="12" fill="url(#topology-grid)" opacity="0.8" />
        <path d="M99 160 C158 160 189 91 270 91 C352 91 378 160 438 160" fill="none" stroke="url(#path-signal)" strokeWidth="2" strokeDasharray="3 7" />
        <path d="M99 160 C158 160 189 91 270 91 C352 91 378 160 438 160" fill="none" stroke="var(--border-strong)" strokeWidth="1" opacity="0.7" />
        <path d="M270 91V202M99 160V208M438 160V208" stroke="var(--border-strong)" strokeWidth="1" strokeDasharray="2 5" opacity="0.65" />
        {nodes.map((node, index) => (
          <g key={node.label}>
            <circle cx={node.x} cy={node.y} r="13" fill="var(--primary)" opacity="0.2" filter="url(#node-halo)" />
            <circle cx={node.x} cy={node.y} r="6" fill="var(--primary)" />
            <circle cx={node.x} cy={node.y} r="14" fill="none" stroke="var(--primary)" strokeOpacity="0.58" />
            <rect x={node.x - 57} y="208" width="114" height="29" rx="6" fill="var(--card)" stroke="var(--border)" />
            <text x={node.x} y="220" textAnchor="middle" className="landing-svg-label">{node.label}</text>
            <text x={node.x} y="231" textAnchor="middle" className="landing-svg-detail">{node.detail}</text>
            {index < nodes.length - 1 && (
              <circle className="landing-flow-dot" cx={index === 0 ? 183 : 356} cy={index === 0 ? 139 : 139} r="3" fill="var(--primary)" />
            )}
          </g>
        ))}
        <text x="270" y="47" textAnchor="middle" className="landing-svg-detail">ILLUSTRATIVE FLOW</text>
      </svg>

      <figcaption className="landing-topology-caption">
        <span>Buyer request</span>
        <ArrowUpRight size={14} aria-hidden="true" />
        <span>Edge gateway</span>
        <ArrowDownRight size={14} aria-hidden="true" />
        <span>Provider capacity</span>
      </figcaption>
    </figure>
  );
}
