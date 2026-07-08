import type { DataPoint } from '../../types';
import { cellValueToNumber } from './cellValueUtils';

/**
 * Columnar typed-array storage for the hot render paths (ROADMAP:
 * "Columnar typed-array storage").
 *
 * Row objects (`DataPoint[]`) remain the source of truth for the table,
 * tooltips, PCA, facets and CSV round-trips; this store is a derived,
 * memoized view used by the per-frame code: point paint loops, scale-domain
 * stats, spatial-grid brush queries and histogram value extraction. One
 * `Float64Array` per numeric column removes the per-point property lookup +
 * string-coercion (`cellValueToNumber`) cost from those loops, and per-column
 * min/max/minPositive fall out of the same single build pass — replacing the
 * per-render row scan that previously computed scale domains.
 *
 * Layout: store row index == index into the `DataPoint[]` the store was
 * built from; `rowIds[i]` is that row's `__id` (which spans the FULL dataset
 * even when the store is built from a faceted subset).
 *
 * Missing-value semantics follow `cellValueUtils`: null / blank /
 * non-numeric cells are stored as NaN (never 0), so sparse rows can neither
 * paint at the origin nor be brush-selected as ghosts.
 */

export interface ColumnVector {
  /** Per-row values in store-row order; NaN for missing/non-numeric cells. */
  values: Float64Array;
  /** Min over finite values; +Infinity when the column has none. */
  min: number;
  /** Max over finite values; -Infinity when the column has none. */
  max: number;
  /** Smallest strictly-positive finite value; +Infinity when none. */
  minPositive: number;
  /** Number of finite values in the column. */
  finiteCount: number;
}

export interface ColumnStore {
  /** Number of rows (== length of every vector and of rowIds). */
  length: number;
  /** rowIds[i] = __id of store row i. */
  rowIds: Int32Array;
  columns: Map<string, ColumnVector>;
}

/**
 * Build a columnar store from row objects in a single pass over the data.
 * `columnNames` are deduplicated; unknown cells simply come out as NaN.
 */
export function buildColumnStore(data: DataPoint[], columnNames: string[]): ColumnStore {
  const n = data.length;
  const rowIds = new Int32Array(n);
  const columns = new Map<string, ColumnVector>();

  const uniqueNames: string[] = [];
  for (const name of columnNames) {
    if (!columns.has(name)) {
      uniqueNames.push(name);
      columns.set(name, {
        values: new Float64Array(n),
        min: Infinity,
        max: -Infinity,
        minPositive: Infinity,
        finiteCount: 0,
      });
    }
  }

  // Iterate rows outermost: one property-hash walk per row object stays
  // cache-friendly and visits each row exactly once.
  const vectors = uniqueNames.map(name => columns.get(name)!);
  for (let i = 0; i < n; i++) {
    const row = data[i];
    rowIds[i] = row.__id;
    for (let c = 0; c < uniqueNames.length; c++) {
      const vec = vectors[c];
      const value = cellValueToNumber(row[uniqueNames[c]]);
      vec.values[i] = value;
      if (value === value) { // finite by construction (NaN otherwise)
        if (value < vec.min) vec.min = value;
        if (value > vec.max) vec.max = value;
        if (value > 0 && value < vec.minPositive) vec.minPositive = value;
        vec.finiteCount++;
      }
    }
  }

  return { length: n, rowIds, columns };
}

/**
 * Per-store-row selection flags: flags[i] = 1 iff rowIds[i] ∈ selectedIds.
 * Returns null for an empty selection so callers can use `flags === null`
 * as the fast "nothing selected" check.
 */
export function buildSelectedFlags(
  store: ColumnStore,
  selectedIds: Set<number>
): Uint8Array | null {
  if (selectedIds.size === 0) return null;
  const { rowIds, length } = store;
  const flags = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    if (selectedIds.has(rowIds[i])) flags[i] = 1;
  }
  return flags;
}

export interface VectorStats {
  min: number;
  max: number;
  minPositive: number;
}

/**
 * Min/max/minPositive over the flagged subset of a vector (used for
 * filter-mode scale domains, where stats cover only the selected rows).
 * Pass `flags = null` to get the precomputed full-column stats.
 */
export function computeVectorStats(
  vector: ColumnVector,
  flags: Uint8Array | null
): VectorStats {
  if (flags === null) {
    return { min: vector.min, max: vector.max, minPositive: vector.minPositive };
  }
  const { values } = vector;
  let min = Infinity;
  let max = -Infinity;
  let minPositive = Infinity;
  for (let i = 0; i < values.length; i++) {
    if (!flags[i]) continue;
    const value = values[i];
    if (value !== value) continue;
    if (value < min) min = value;
    if (value > max) max = value;
    if (value > 0 && value < minPositive) minPositive = value;
  }
  return { min, max, minPositive };
}

/**
 * Finite values of a column as a plain number[] (d3.bin input), optionally
 * restricted to flagged rows. Replaces `rows.map(cellValueToNumber)
 * .filter(isFinite)` in the histogram path.
 */
export function collectFiniteValues(
  vector: ColumnVector,
  flags: Uint8Array | null = null
): number[] {
  const { values } = vector;
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (flags !== null && !flags[i]) continue;
    const value = values[i];
    if (value === value) out.push(value);
  }
  return out;
}

/**
 * Ids of rows whose value in `vector` lies inside [min, max]. NaN (missing)
 * never matches — the columnar replacement for the histogram-brush row scan
 * (whose old `+row[col]` coercion silently treated missing cells as 0).
 */
export function selectIdsInValueRange(
  store: ColumnStore,
  vector: ColumnVector,
  min: number,
  max: number
): Set<number> {
  const { values } = vector;
  const { rowIds } = store;
  const selected = new Set<number>();
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value >= min && value <= max) selected.add(rowIds[i]);
  }
  return selected;
}
