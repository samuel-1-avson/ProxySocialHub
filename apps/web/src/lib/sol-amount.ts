/** Parse SOL exactly; reject fractions smaller than one lamport and unsafe API integers. */
export function parseSolAmountLamports(value: string): number | null {
  if (!/^\d+(?:\.\d{1,9})?$/.test(value.trim())) return null;
  const [whole, fraction = ""] = value.trim().split(".");
  const lamports =
    BigInt(whole) * BigInt(1_000_000_000) + BigInt(fraction.padEnd(9, "0"));
  return lamports <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(lamports) : null;
}
