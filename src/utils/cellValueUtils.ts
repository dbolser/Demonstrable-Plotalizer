// PapaParse (dynamicTyping) stores empty cells as null, and `+null === 0`,
// so a plain `isFinite(+raw)` treats missing values as real zeros. These
// helpers are the single place that decides whether a cell holds a usable
// number; every coercion site in the render/selection path goes through them.

export function isFiniteCellValue(raw: number | string | null | undefined): boolean {
  if (raw === null || raw === undefined) return false;
  if (typeof raw === 'string' && raw.trim() === '') return false;
  return Number.isFinite(+raw);
}

/** Coerce a raw cell to a number, yielding NaN for missing/blank/non-numeric. */
export function cellValueToNumber(raw: number | string | null | undefined): number {
  return isFiniteCellValue(raw) ? +(raw as number | string) : NaN;
}
