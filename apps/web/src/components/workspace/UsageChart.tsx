import type { CSSProperties } from "react";
import { BarChart3 } from "lucide-react";
import { amount, shortDate } from "./Patterns";

interface UsagePoint {
  date: string;
  gb_used?: number;
  bytes_used?: number;
}

export function UsageChart({ points }: { points: UsagePoint[] }) {
  const values = points.map((point) => ({
    date: point.date,
    gb:
      Number.isFinite(point.gb_used) && point.gb_used != null
        ? Math.max(0, point.gb_used)
        : Number.isFinite(point.bytes_used) && point.bytes_used != null
          ? Math.max(0, point.bytes_used / 1024 ** 3)
          : null,
  }));
  const peak = Math.max(0, ...values.map((point) => point.gb ?? 0));
  const total = values.reduce((sum, point) => sum + (point.gb ?? 0), 0);
  return (
    <section className="ui-surface usage-panel">
      <div className="ui-section-heading">
        <div>
          <p className="ui-eyebrow">Usage over time</p>
          <h2>Daily bandwidth</h2>
        </div>
        <span className="ui-tag">Last 7 days</span>
      </div>
      {values.length ? (
        <>
          <div className="usage-chart-summary">
            <strong>
              {amount(total, 3)} <span>GB</span>
            </strong>
            <p>Total across returned measurements</p>
          </div>
          <figure className="usage-chart">
            <figcaption className="sr-only">
              Daily reported bandwidth in gigabytes. Missing measurements are
              marked unavailable.
            </figcaption>
            <div className="usage-chart-axis" aria-hidden="true">
              <span>{amount(peak, 3)} GB</span>
              <span>{amount(peak / 2, 3)}</span>
              <span>0</span>
            </div>
            <ol className="usage-chart-bars">
              {values.map((point) => (
                <li
                  key={point.date}
                  aria-label={
                    shortDate(point.date) +
                    ": " +
                    (point.gb == null
                      ? "Unavailable"
                      : amount(point.gb, 3) + " GB")
                  }
                >
                  <span className="usage-chart-value">
                    {point.gb == null ? "No data" : amount(point.gb, 3)}
                  </span>
                  <div className="usage-chart-track">
                    <span
                      className={point.gb == null ? "unavailable" : ""}
                      style={
                        {
                          "--usage-height":
                            (peak > 0 && point.gb != null
                              ? (point.gb / peak) * 100
                              : 0) + "%",
                        } as CSSProperties
                      }
                    />
                  </div>
                  <span className="usage-chart-date">
                    {shortDate(point.date)}
                  </span>
                </li>
              ))}
            </ol>
          </figure>
          <details className="usage-chart-details">
            <summary>View exact measurements</summary>
            <div className="ui-table-wrap">
              <table className="ui-table">
                <caption className="sr-only">Daily bandwidth usage</caption>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Reported usage</th>
                  </tr>
                </thead>
                <tbody>
                  {values.map((point) => (
                    <tr key={point.date}>
                      <th scope="row">{shortDate(point.date)}</th>
                      <td>
                        {point.gb == null
                          ? "Unavailable"
                          : amount(point.gb, 3) + " GB"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      ) : (
        <div className="usage-chart-empty">
          <BarChart3 size={30} aria-hidden="true" />
          <h3>Your usage will take shape here.</h3>
          <p>No daily measurements were returned for this period.</p>
        </div>
      )}
    </section>
  );
}
