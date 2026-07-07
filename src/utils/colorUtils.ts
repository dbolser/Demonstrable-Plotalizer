import { interpolateViridis } from 'd3';
import type { DataPoint, ColorMode } from '../../types';

// Bump when the palette or gradient assignment scheme changes so cached
// canvas pixels rendered with the old colors can never be restored.
export const PALETTE_VERSION = 1;

// Colorblind-friendly 10-color categorical palette (Tableau 10).
// Hard-coded (rather than referencing d3.schemeTableau10) so the palette —
// and therefore every cached pixel keyed by PALETTE_VERSION — is stable
// across d3 upgrades.
export const CATEGORY_PALETTE: readonly string[] = [
  '#4e79a7', '#f28e2c', '#e15759', '#76b7b4', '#59a14f',
  '#edc949', '#af7aa1', '#ff9da7', '#9c755f', '#bab0ab',
];

// Number of discrete gradient buckets used for rainbow point coloring.
// 64 steps of viridis are visually indistinguishable from a continuous
// gradient at 2.5px point radius, while keeping the paint loop batched
// into at most 64 fill calls per cell.
export const RAINBOW_BUCKETS = 64;

// Sentinel slot for rows whose value is missing / non-finite under the
// active coloring. Documented behavior: NaN / missing rows are drawn in a
// neutral gray rather than being folded into the gradient, so they cannot
// be mistaken for genuinely low-ranked rows.
export const MISSING_SLOT = 0xffff;
export const MISSING_COLOR = '#9ca3af';

export interface CategoryLegendEntry {
  name: string;
  color: string;
}

export interface ColorState {
  mode: Exclude<ColorMode, 'none'>;
  /**
   * Color slot per row, indexed by `__id`. Values index into `slotColors`,
   * or `MISSING_SLOT` for rows drawn in `MISSING_COLOR`.
   */
  slotById: Uint16Array;
  /** Fill color per slot (10 palette colors or RAINBOW_BUCKETS viridis steps). */
  slotColors: string[];
  /** Legend entries (category mode only). */
  categories: CategoryLegendEntry[] | null;
  /** Rainbow mode: column whose rank drives the gradient; null = file order. */
  orderColumn: string | null;
  /**
   * Hash of everything that changes point colors, for render cache keys:
   * mode + category column + ordering column + palette version.
   */
  hash: string;
}

/** Viridis colors for the rainbow gradient buckets. */
export function buildRainbowColors(buckets: number = RAINBOW_BUCKETS): string[] {
  if (buckets <= 1) return [interpolateViridis(0)];
  return Array.from({ length: buckets }, (_, i) => interpolateViridis(i / (buckets - 1)));
}

/**
 * Category color slots: each row gets the palette slot of its category.
 * Categories are discovered in order of first appearance; the palette
 * cycles for datasets with more than CATEGORY_PALETTE.length categories
 * (slot = categoryIndex % palette size), so two categories may share a
 * color but the paint loop stays bounded at 10 fill batches per cell.
 * Rows whose value is missing/empty get MISSING_SLOT.
 */
export function computeCategorySlots(
  data: DataPoint[],
  columnName: string
): { slotById: Uint16Array; categories: CategoryLegendEntry[] } {
  const slotById = new Uint16Array(data.length).fill(MISSING_SLOT);
  const categoryIndex = new Map<string, number>();
  const categories: CategoryLegendEntry[] = [];

  for (const row of data) {
    const raw = row[columnName];
    if (raw === undefined || raw === null || raw === '') continue;
    const value = String(raw);
    let idx = categoryIndex.get(value);
    if (idx === undefined) {
      idx = categories.length;
      categoryIndex.set(value, idx);
      categories.push({
        name: value,
        color: CATEGORY_PALETTE[idx % CATEGORY_PALETTE.length],
      });
    }
    const id = row.__id;
    if (id >= 0 && id < slotById.length) {
      slotById[id] = idx % CATEGORY_PALETTE.length;
    }
  }

  return { slotById, categories };
}

/**
 * Rainbow gradient slots.
 *
 * - `orderColumn === null`: gradient follows position in the input file
 *   (row 0 = gradient start). Every row gets a bucket.
 * - `orderColumn` set: gradient follows the row's rank in that column.
 *   Ties are broken by original row order (stable). Rows with missing /
 *   non-finite values get MISSING_SLOT (neutral gray) — documented choice:
 *   gray rather than gradient-start, so missing data is visually distinct.
 */
export function computeRainbowSlots(
  data: DataPoint[],
  orderColumn: string | null,
  buckets: number = RAINBOW_BUCKETS
): Uint16Array {
  const n = data.length;
  const slotById = new Uint16Array(n).fill(MISSING_SLOT);
  const maxSlot = buckets - 1;

  // Map rank r of `count` rows onto [0, maxSlot] so the gradient always
  // spans its full range, even for small datasets.
  const bucketFor = (r: number, count: number) =>
    count <= 1 ? 0 : Math.min(maxSlot, Math.round((r * maxSlot) / (count - 1)));

  if (orderColumn === null) {
    for (let i = 0; i < n; i++) {
      const id = data[i].__id;
      if (id < 0 || id >= n) continue;
      slotById[id] = bucketFor(i, n);
    }
    return slotById;
  }

  // Collect finite values with their original position for stable ties.
  const entries: { id: number; value: number; pos: number }[] = [];
  for (let i = 0; i < n; i++) {
    const value = +data[i][orderColumn];
    if (!isFinite(value)) continue;
    const id = data[i].__id;
    if (id < 0 || id >= n) continue;
    entries.push({ id, value, pos: i });
  }

  entries.sort((a, b) => (a.value - b.value) || (a.pos - b.pos));

  const count = entries.length;
  for (let r = 0; r < count; r++) {
    slotById[entries[r].id] = bucketFor(r, count);
  }
  return slotById;
}

/** Cache-key fragment covering everything that changes point colors. */
export function computeColorStateHash(
  mode: ColorMode,
  categoryColumn: string | null,
  orderColumn: string | null
): string {
  if (mode === 'none') return 'none';
  return `${mode}:${mode === 'category' ? categoryColumn ?? '' : ''}:${
    mode === 'rainbow' ? orderColumn ?? '' : ''
  }:p${PALETTE_VERSION}`;
}

/**
 * Precompute the full per-row color state for the active mode, or null when
 * no coloring applies (mode 'none', empty data, or category mode without a
 * chosen column). Called once per mode/column/data change — the paint loop
 * only does typed-array lookups.
 */
export function computeColorState(
  data: DataPoint[],
  mode: ColorMode,
  categoryColumn: string | null,
  orderColumn: string | null
): ColorState | null {
  if (mode === 'none' || data.length === 0) return null;

  if (mode === 'category') {
    if (!categoryColumn) return null;
    const { slotById, categories } = computeCategorySlots(data, categoryColumn);
    return {
      mode,
      slotById,
      slotColors: CATEGORY_PALETTE.slice(),
      categories,
      orderColumn: null,
      hash: computeColorStateHash(mode, categoryColumn, null),
    };
  }

  return {
    mode,
    slotById: computeRainbowSlots(data, orderColumn),
    slotColors: buildRainbowColors(),
    categories: null,
    orderColumn,
    hash: computeColorStateHash(mode, null, orderColumn),
  };
}
