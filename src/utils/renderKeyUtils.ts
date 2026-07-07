export interface RenderKeyParts {
  xColName: string;
  yColName: string;
  xScale: string;
  yScale: string;
  filterMode: string;
  dataStateHash: string;
  selectedStateHash: string;
  size: number;
  /** From computeColorStateHash / ColorState.hash; 'none' when no coloring. */
  colorStateHash: string;
}

/**
 * Cache key for a rendered scatter cell. Gates both the "skip repaint"
 * check and the per-canvas ImageData LRU, so it MUST include every input
 * that can change the cell's pixels — including the color state hash
 * (mode + category column + ordering column + palette version).
 */
export function buildRenderKey(parts: RenderKeyParts): string {
  return `${parts.xColName}-${parts.yColName}-${parts.xScale}-${parts.yScale}-${parts.filterMode}-${parts.dataStateHash}-${parts.selectedStateHash}-${parts.size}-${parts.colorStateHash}`;
}
