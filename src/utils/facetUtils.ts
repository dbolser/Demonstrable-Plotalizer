import type { DataPoint } from '../../types';

/**
 * Faceted filtering by category (string) columns — issue #41.
 *
 * Semantics:
 * - `FacetSelections` maps a column name to the set of values the user has
 *   checked. A column absent from the map (or with an empty set) places NO
 *   restriction on rows — all pass. The map only ever stores non-empty sets;
 *   helpers delete a column's entry when its set becomes empty.
 * - Rows must pass ALL actively-faceted columns (AND across columns) and
 *   match ANY selected value within a column (OR within a column).
 * - Missing / blank cells (undefined, null, or whitespace-only strings) are
 *   represented by the dedicated MISSING_FACET_VALUE entry; they only pass a
 *   column's facet if that entry is selected. (A real cell whose text equals
 *   the sentinel is indistinguishable from a missing cell — accepted edge
 *   case.)
 */

/** Sentinel facet entry representing missing / blank cells. */
export const MISSING_FACET_VALUE = '(missing)';

/**
 * Columns with more distinct values than this are not offered as facets —
 * rendering thousands of checkboxes helps nobody.
 */
export const MAX_FACET_VALUES = 30;

export type FacetSelections = Map<string, Set<string>>;

export interface FacetValueCount {
  /** Display/selection value; MISSING_FACET_VALUE for missing cells. */
  value: string;
  isMissing: boolean;
  /** Row count within the data faceted by all OTHER columns' facets. */
  count: number;
}

export interface FacetColumnSummary {
  column: string;
  /** Distinct values in the FULL dataset (incl. the missing entry, if any). */
  distinctCount: number;
  /** False when distinctCount exceeds MAX_FACET_VALUES. */
  facetable: boolean;
  /** Empty when not facetable. */
  values: FacetValueCount[];
}

/** Facet value of a cell: its string form, or the missing sentinel. */
export function getFacetValue(row: DataPoint, column: string): string {
  const raw = row[column];
  if (raw === undefined || raw === null) return MISSING_FACET_VALUE;
  const value = String(raw);
  return value.trim() === '' ? MISSING_FACET_VALUE : value;
}

/** True when the row passes every active facet (AND across columns). */
export function rowPassesFacets(row: DataPoint, facets: FacetSelections): boolean {
  for (const [column, values] of facets) {
    if (values.size === 0) continue; // defensive: empty set = no facet
    if (!values.has(getFacetValue(row, column))) return false;
  }
  return true;
}

/** Number of columns with an active (non-empty) facet. */
export function countActiveFacets(facets: FacetSelections): number {
  let count = 0;
  for (const values of facets.values()) {
    if (values.size > 0) count++;
  }
  return count;
}

/**
 * Rows passing all active facets. Returns the input array itself when no
 * facet is active — the identity is load-bearing: downstream canvas caches
 * key off the data array reference (ScatterPlotMatrix bumps its data version
 * whenever the reference changes), so "no facets" must not allocate a new
 * array, and any facet change must.
 */
export function applyFacets(data: DataPoint[], facets: FacetSelections): DataPoint[] {
  if (countActiveFacets(facets) === 0) return data;
  return data.filter(row => rowPassesFacets(row, facets));
}

/**
 * Toggle one value in one column's facet. Returns a new map (new set for the
 * touched column); the column's entry is removed entirely when its set
 * empties, restoring "no facet on this column".
 */
export function toggleFacetValue(
  facets: FacetSelections,
  column: string,
  value: string
): FacetSelections {
  const next = new Map(facets);
  const values = new Set(next.get(column) ?? []);
  if (values.has(value)) {
    values.delete(value);
  } else {
    values.add(value);
  }
  if (values.size === 0) {
    next.delete(column);
  } else {
    next.set(column, values);
  }
  return next;
}

/**
 * Replace one column's facet wholesale ("all" / "none" shortcuts). Passing
 * null or an empty set clears the column's facet.
 */
export function setColumnFacet(
  facets: FacetSelections,
  column: string,
  values: Set<string> | null
): FacetSelections {
  const next = new Map(facets);
  if (!values || values.size === 0) {
    next.delete(column);
  } else {
    next.set(column, new Set(values));
  }
  return next;
}

/** Distinct facet values of a column across the given rows, with counts. */
function countValues(data: DataPoint[], column: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of data) {
    const value = getFacetValue(row, column);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

/**
 * Build the per-column facet UI model.
 *
 * Standard faceting counts: each column's value counts are computed within
 * the data restricted by all OTHER columns' facets (its own facet is
 * excluded, so unchecked values keep showing what selecting them would add).
 * Values not present in that restricted view but selected or present in the
 * full dataset still appear with count 0, so active checkboxes never vanish.
 *
 * Columns whose FULL-dataset distinct count exceeds MAX_FACET_VALUES are
 * flagged not facetable and get no value list.
 */
export function buildFacetSummaries(
  data: DataPoint[],
  stringColumns: string[],
  facets: FacetSelections
): FacetColumnSummary[] {
  // For a column WITHOUT its own facet, "all OTHER columns' facets" equals
  // ALL active facets — so every such column shares one filtered view.
  // Compute it lazily once instead of re-scanning the dataset per column.
  let sharedOtherView: DataPoint[] | null = null;
  const getSharedOtherView = () =>
    (sharedOtherView ??= applyFacets(data, facets));

  return stringColumns.map(column => {
    const globalCounts = countValues(data, column);
    const distinctCount = globalCounts.size;
    if (distinctCount > MAX_FACET_VALUES) {
      return { column, distinctCount, facetable: false, values: [] };
    }

    // Counts within the view faceted by every OTHER column.
    const ownFacet = facets.get(column);
    const hasOwnFacet = ownFacet !== undefined && ownFacet.size > 0;
    const otherFacetCount = countActiveFacets(facets) - (hasOwnFacet ? 1 : 0);
    const facetedCounts =
      otherFacetCount === 0
        ? globalCounts
        : hasOwnFacet
          ? countValues(applyFacets(data, setColumnFacet(facets, column, null)), column)
          : countValues(getSharedOtherView(), column);

    const values: FacetValueCount[] = [...globalCounts.keys()]
      .map(value => ({
        value,
        isMissing: value === MISSING_FACET_VALUE,
        count: facetedCounts.get(value) ?? 0,
      }))
      // Stable, predictable order: alphabetical, missing entry last.
      .sort((a, b) =>
        a.isMissing !== b.isMissing
          ? Number(a.isMissing) - Number(b.isMissing)
          : a.value.localeCompare(b.value)
      );

    return { column, distinctCount, facetable: true, values };
  });
}
