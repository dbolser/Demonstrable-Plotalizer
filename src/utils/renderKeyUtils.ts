/**
 * Builder for a scatter cell's render key. The key identifies everything
 * that affects the pixels of one cell canvas: if any input changes, the key
 * changes, invalidating both the per-canvas "already painted" check and the
 * ImageData LRU snapshot lookup in ScatterPlotMatrix.
 *
 * Anything new that changes cell pixels (e.g. reference-line toggles) MUST
 * be folded in here — a stale key would resurrect stale pixels from cache.
 */
export interface CellRenderKeyParams {
    xColName: string;
    yColName: string;
    xScaleType: string;
    yScaleType: string;
    filterMode: string;
    dataStateHash: string;
    selectedStateHash: string;
    size: number;
    showIdentityLine: boolean;
    showRegressionLine: boolean;
}

export function buildCellRenderKey(p: CellRenderKeyParams): string {
    const refLines = `ref${p.showIdentityLine ? 1 : 0}${p.showRegressionLine ? 1 : 0}`;
    return `${p.xColName}-${p.yColName}-${p.xScaleType}-${p.yScaleType}-${p.filterMode}-${p.dataStateHash}-${p.selectedStateHash}-${p.size}-${refLines}`;
}
