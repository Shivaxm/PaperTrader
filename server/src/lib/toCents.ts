export function toCents(p: number | null | undefined): number | null {
  if (p === null || p === undefined || !Number.isFinite(p)) return null;
  return Math.round(p * 100);
}
