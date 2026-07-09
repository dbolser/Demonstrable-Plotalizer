import { interpolateViridis } from 'd3';
import type { DataPoint, ColorMode } from '../../types';

// Bump when the palette or gradient assignment scheme changes so cached
// canvas pixels rendered with the old colors can never be restored.
// v2: category slots are assigned by count rank (largest category = slot 0)
// instead of first appearance.
export const PALETTE_VERSION = 2;

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

// Sentinel slot for rows whose category has been toggled off in the legend.
// Distinct from MISSING_SLOT: hidden rows are not painted at all (and are
// excluded from brush hits and stacked histograms), whereas missing rows
// stay visible in neutral gray.
export const HIDDEN_SLOT = 0xfffe;

export interface CategoryLegendEntry {
  name: string;
  color: string;
  /** Rows carrying this category value (over the full dataset). */
  count: number;
  /** True when the category is toggled off via the legend. */
  hidden: boolean;
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
  /** Legend entries, sorted by count descending (category mode only). */
  categories: CategoryLegendEntry[] | null;
  /** True when at least one category is toggled off (HIDDEN_SLOT in use). */
  hasHidden: boolean;
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
 * Categories are ranked by row count, descending (ties broken by first
 * appearance), and slot = rank % palette size. Ranking by size means the
 * paint loops — which draw slot 0 first — put the biggest categories at
 * the bottom of the z-order, so rarer categories stay visible on top.
 * The palette cycles for datasets with more than CATEGORY_PALETTE.length
 * categories, so two categories may share a color but the paint loop stays
 * bounded at 10 fill batches per cell.
 * Rows whose value is missing/empty get MISSING_SLOT; rows whose category
 * is in `hiddenCategories` get HIDDEN_SLOT (not painted at all).
 */
export function computeCategorySlots(
  data: DataPoint[],
  columnName: string,
  hiddenCategories: ReadonlySet<string> = new Set()
): { slotById: Uint16Array; categories: CategoryLegendEntry[] } {
  const slotById = new Uint16Array(data.length).fill(MISSING_SLOT);

  // Pass 1: count rows per category value (Map preserves first appearance).
  const counts = new Map<string, number>();
  for (const row of data) {
    const raw = row[columnName];
    if (raw === undefined || raw === null || raw === '') continue;
    const value = String(raw);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  // Rank by count descending; Array.sort is stable, so equal counts keep
  // first-appearance order.
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  const slotByValue = new Map<string, number>();
  const categories: CategoryLegendEntry[] = ranked.map(([name, count], rank) => {
    const hidden = hiddenCategories.has(name);
    const slot = rank % CATEGORY_PALETTE.length;
    slotByValue.set(name, hidden ? HIDDEN_SLOT : slot);
    return { name, color: CATEGORY_PALETTE[slot], count, hidden };
  });

  // Pass 2: assign each row its category's slot.
  for (const row of data) {
    const raw = row[columnName];
    if (raw === undefined || raw === null || raw === '') continue;
    const id = row.__id;
    if (id >= 0 && id < slotById.length) {
      slotById[id] = slotByValue.get(String(raw))!;
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
  // Missing cells must be rejected BEFORE numeric coercion: PapaParse
  // (dynamicTyping) stores empty cells as null, and +null === 0, which
  // would silently rank blank rows as real zero-valued rows instead of
  // giving them MISSING_SLOT.
  const entries: { id: number; value: number; pos: number }[] = [];
  for (let i = 0; i < n; i++) {
    const raw = data[i][orderColumn];
    if (raw === null || raw === undefined) continue;
    if (typeof raw === 'string' && raw.trim() === '') continue;
    const value = +raw;
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
  orderColumn: string | null,
  hiddenCategories: ReadonlySet<string> = new Set()
): string {
  if (mode === 'none') return 'none';
  // Hidden categories change which points are painted, so they must
  // invalidate cached pixels; sorted for a stable key.
  const hidden = mode === 'category' && hiddenCategories.size > 0
    ? `:hid[${[...hiddenCategories].sort().join('\u0001')}]`
    : '';
  return `${mode}:${mode === 'category' ? categoryColumn ?? '' : ''}:${
    mode === 'rainbow' ? orderColumn ?? '' : ''
  }:p${PALETTE_VERSION}${hidden}`;
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
  orderColumn: string | null,
  hiddenCategories: ReadonlySet<string> = new Set()
): ColorState | null {
  if (mode === 'none' || data.length === 0) return null;

  if (mode === 'category') {
    if (!categoryColumn) return null;
    const { slotById, categories } = computeCategorySlots(data, categoryColumn, hiddenCategories);
    return {
      mode,
      slotById,
      slotColors: CATEGORY_PALETTE.slice(),
      categories,
      hasHidden: categories.some(c => c.hidden),
      orderColumn: null,
      hash: computeColorStateHash(mode, categoryColumn, null, hiddenCategories),
    };
  }

  return {
    mode,
    slotById: computeRainbowSlots(data, orderColumn),
    slotColors: buildRainbowColors(),
    categories: null,
    hasHidden: false,
    orderColumn,
    hash: computeColorStateHash(mode, null, orderColumn),
  };
}

/**
 * Drop rows of hidden categories from a brush hit set, so toggled-off
 * points cannot be selected invisibly. Returns the input set unchanged
 * (same reference) when nothing is hidden.
 */
export function removeHiddenIds(
  ids: Set<number>,
  colorState: ColorState | null
): Set<number> {
  if (!colorState?.hasHidden || ids.size === 0) return ids;
  const { slotById } = colorState;
  const out = new Set<number>();
  for (const id of ids) {
    if (slotById[id] !== HIDDEN_SLOT) out.add(id);
  }
  return out;
}
