"use client";

import { useState } from "react";
import { TrendingUp, Zap, AlertCircle } from "lucide-react";
import { triggerPricingAdjustment } from "@/lib/api";

export default function PricingPage() {
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  const trigger = async () => {
    if (!confirm("Trigger a dynamic pricing recalculation across all nodes?")) return;
    setStatus("running");
    setMessage("");
    try {
      const res = await triggerPricingAdjustment() as { message?: string };
      setStatus("done");
      setMessage(res?.message ?? "Pricing adjustment triggered successfully.");
    } catch (e) {
      setStatus("error");
      setMessage(String(e));
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div className="admin-card space-y-5">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-indigo-400" />
          <h2 className="text-sm font-semibold text-white">Dynamic Pricing Control</h2>
        </div>

        <p className="text-sm text-[#94a3b8]">
          Triggering a pricing adjustment recalculates bandwidth rates across all active provider nodes
          based on supply, demand, quality scores, and current market conditions.
        </p>

        <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-300">
            This operation runs asynchronously in the background. Pricing changes take effect within 30–60 seconds
            and may affect active session costs.
          </p>
        </div>

        <button
          onClick={trigger}
          disabled={status === "running"}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
        >
          <Zap className={`w-4 h-4 ${status === "running" ? "animate-pulse" : ""}`} />
          {status === "running" ? "Adjusting Prices…" : "Trigger Pricing Adjustment"}
        </button>

        {status === "done" && (
          <div className="flex items-center gap-2 text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-4 py-3">
            <Zap className="w-4 h-4" />
            {message}
          </div>
        )}
        {status === "error" && (
          <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
            <AlertCircle className="w-4 h-4" />
            {message}
          </div>
        )}
      </div>

      <div className="admin-card">
        <h3 className="text-sm font-semibold text-white mb-4">How Pricing Works</h3>
        <div className="space-y-3 text-sm text-[#94a3b8]">
          {[
            ["Demand Signal", "Calculated from active session volume relative to total available capacity."],
            ["Quality Score", "Provider tier (new/verified/premium) affects base rate multiplier."],
            ["Geographic Premium", "Rare geo-locations command higher base rates."],
            ["Bandwidth Cost", "Estimated from node usage history and ISP costs."],
            ["Settlement", "All prices are denominated in SOL and updated in system_configurations."],
          ].map(([title, desc]) => (
            <div key={title as string} className="flex gap-3">
              <span className="text-indigo-400 shrink-0">▸</span>
              <div>
                <span className="text-white font-medium">{title}: </span>
                {desc}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
