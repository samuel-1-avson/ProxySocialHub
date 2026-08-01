export function formatSOL(n: number): string {
  if (n === 0) return '0.0000';
  const absVal = Math.abs(n);
  if (absVal >= 0.01) {
    return n.toFixed(4);
  }
  return n.toFixed(6);
}
