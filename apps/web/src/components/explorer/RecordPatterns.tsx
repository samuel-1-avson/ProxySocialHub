"use client";
import { useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  EmptyState,
  PageHeading,
  amount,
} from "@/components/workspace/Patterns";
import type { AnalyticsPoint } from "@/lib/services/explorer";
const subscribe = () => () => {};
export function RecordHeading({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <>
      <Link href="/explorer" className="ui-link record-back">
        <ArrowLeft size={14} />
        Explorer overview
      </Link>
      <PageHeading
        eyebrow="Public network records"
        title={title}
        description={description}
        actions={children}
      />
    </>
  );
}
export function PeriodControl({
  value,
  onChange,
  periods = ["1h", "24h", "7d", "30d"],
}: {
  value: string;
  onChange: (value: string) => void;
  periods?: string[];
}) {
  return (
    <div className="record-periods" role="group" aria-label="Reporting period">
      {periods.map((period) => (
        <button
          type="button"
          key={period}
          aria-pressed={value === period}
          onClick={() => onChange(period)}
        >
          {period}
        </button>
      ))}
    </div>
  );
}
export function RecordChart({
  title,
  description,
  points,
  unit = "",
  unavailable,
}: {
  title: string;
  description: string;
  points: AnalyticsPoint[];
  unit?: string;
  unavailable?: string;
}) {
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const data = points
    .filter((point) => Number.isFinite(point.value))
    .map((point) => ({
      ...point,
      label: new Date(point.timestamp).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    }));
  return (
    <section className="ui-surface record-chart">
      <div className="ui-section-heading">
        <div>
          <h2>{title}</h2>
          <p className="ui-subtle">{description}</p>
        </div>
      </div>
      {!data.length ? (
        <EmptyState
          title={
            unavailable
              ? "Measurements unavailable"
              : "No measurements returned"
          }
          description={
            unavailable || "There are no recorded measurements for this period."
          }
        />
      ) : (
        <>
          <div className="record-chart-canvas" aria-hidden="true">
            {hydrated && (
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <AreaChart accessibilityLayer={false}
                  data={data}
                  margin={{ top: 12, right: 14, bottom: 12, left: 0 }}
                >
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                    minTickGap={45}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    width={50}
                    tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--popover)",
                      color: "var(--foreground)",
                      border: "1px solid var(--border)",
                      borderRadius: 10,
                      fontSize: 12,
                    }}
                    formatter={(value) => [
                      amount(Number(value), 4) + (unit ? " " + unit : ""),
                      title,
                    ]}
                  />
                  <Area
                    isAnimationActive={false}
                    type="linear"
                    dataKey="value"
                    stroke="var(--primary)"
                    fill="var(--primary)"
                    fillOpacity={0.12}
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
          <details className="record-measurements">
            <summary>View exact measurements · {unit || "count"}</summary>
            <div className="record-table-scroll" role="region" tabIndex={0} aria-label={title + " exact measurements"}>
              <table className="record-table">
                <caption className="sr-only">{title}</caption>
                <thead>
                  <tr>
                    <th scope="col">Timestamp</th>
                    <th scope="col">Value {unit && "(" + unit + ")"}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((point, index) => (
                    <tr key={point.timestamp + index}>
                      <th scope="row">
                        {new Date(point.timestamp).toLocaleString()}
                      </th>
                      <td>{amount(point.value, 6)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
export function exportRecords(
  filename: string,
  headers: string[],
  rows: unknown[][],
) {
  const csv = [headers, ...rows]
    .map((row) =>
      row
        .map((value) => {
          const raw = String(value ?? "");
          const safe = /^[=+@\-\t\r]/.test(raw) ? "'" + raw : raw;
          return '"' + safe.replace(/"/g, '""') + '"';
        })
        .join(","),
    )
    .join("\r\n");
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
