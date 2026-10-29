/** Preserve absence: missing observations are not reported zeroes. */
export function measurement(value: unknown): number | undefined {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function measured(value: unknown, digits = 2, unit = ''): string {
  const parsed = measurement(value);
  return parsed === undefined ? 'Not reported' : `${parsed.toLocaleString(undefined, { maximumFractionDigits: digits })}${unit ? ` ${unit}` : ''}`;
}

export function meanMeasurements(values: unknown[]): number | undefined {
  const reported = values.map(measurement).filter((value): value is number => value !== undefined);
  return reported.length ? reported.reduce((sum, value) => sum + value, 0) / reported.length : undefined;
}

/** Totals are unavailable if any contributing measurement is missing. */
export function sumMeasurements(values: unknown[]): number | undefined {
  const reported = values.map(measurement);
  if (reported.some(value => value === undefined)) return undefined;
  return (reported as number[]).reduce((sum, value) => sum + value, 0);
}
