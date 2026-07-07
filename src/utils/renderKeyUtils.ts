export interface RenderKeyParts {
  xColName: string;
  yColName: string;
  xScale: string;
  yScale: string;
  filterMode: string;
  dataStateHash: string;
  selectedStateHash: string;
  size: number;
  /** Identity (y = x) reference line toggle. */
  showIdentityLine: boolean;
  /** Least-squares regression line toggle. */
  showRegressionLine: boolean;
  /** From computeColorStateHash / ColorState.hash; 'none' when no coloring. */
  colorStateHash: string;
}

// Field separator for render keys. A control character rather than '-' so
// user-controlled fragments (CSV column names inside colName / colorStateHash)
// containing dashes can never shift field boundaries and make two different
// configurations collide on the same cache key, e.g. ("a-b", "c") vs
// ("a", "b-c") resurrecting the wrong cached cell image.
const SEP = '\u0001';

/**
 * Cache key for a rendered scatter cell. Gates both the "skip repaint"
 * check and the per-canvas ImageData LRU, so it MUST include every input
 * that can change the cell's pixels — scales, filter mode, data/selection
 * state, cell size, reference-line toggles (identity/regression) and the
 * color state hash (mode + category column + ordering column + palette
 * version). Anything new that changes cell pixels MUST be folded in here —
 * a stale key would resurrect stale pixels from cache.
 */
export function buildRenderKey(parts: RenderKeyParts): string {
  const refLines = `ref${parts.showIdentityLine ? 1 : 0}${parts.showRegressionLine ? 1 : 0}`;
  return [
    parts.xColName,
    parts.yColName,
    parts.xScale,
    parts.yScale,
    parts.filterMode,
    parts.dataStateHash,
    parts.selectedStateHash,
    parts.size,
    refLines,
    parts.colorStateHash,
  ].join(SEP);
}
