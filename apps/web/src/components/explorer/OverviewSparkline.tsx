"use client";

import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

function SparkTooltip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ value?: number | string }> }) {
  if (!active || !payload?.length) return null;
  return <div className="bg-card border border-border rounded-lg px-2 py-1 text-xs font-mono font-semibold text-foreground">
    {typeof payload[0].value === "number" ? payload[0].value.toFixed(2) : payload[0].value}
  </div>;
}
/** Load chart code only when an actual series is available; exact records live in Analytics. */
export default function OverviewSparkline({ data, color, gradientId }: { data: { v: number }[]; color: string; gradientId: string }) {
  return <div className="h-10 -mx-2 opacity-30 group-hover:opacity-60 transition-opacity" style={{ minHeight: 40 }} aria-hidden="true">
    <ResponsiveContainer width="100%" height={40} minWidth={1} minHeight={1} initialDimension={{ width: 240, height: 40 }}>
      <AreaChart data={data} accessibilityLayer={false} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
        <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={color} stopOpacity={0.4} /><stop offset="95%" stopColor={color} stopOpacity={0} /></linearGradient></defs>
        <XAxis dataKey="v" hide /><YAxis hide />
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill={"url(#" + gradientId + ")"} dot={false} isAnimationActive={false} />
        <Tooltip content={<SparkTooltip />} />
      </AreaChart>
    </ResponsiveContainer>
  </div>;
}
