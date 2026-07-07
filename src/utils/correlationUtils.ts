import type { Column, DataPoint } from '../../types';
import { fitRegression } from './referenceLineUtils';
import type { RegressionFit } from './referenceLineUtils';
import { cellValueToNumber } from './cellValueUtils';

/**
 * Per-cell correlation metrics (issue #36).
 *
 * All math here is pure and canvas-free so it unit-tests without a DOM.
 *
 * Metric semantics:
 * - Pearson r for a cell is derived from the least-squares fit that the
 *   regression overlay (issue #50) already computes: r = sign(slope)·√r².
 *   The fit lives in *transformed* space (log10 for log axes), so the badge
 *   reports the correlation of the point cloud as actually drawn — and the
 *   two features share one memoized computation.
 * - Spearman ρ is Pearson on average ranks. Ranks are invariant under the
 *   monotone log transform, but the log axes still decide which rows are
 *   excluded (non-positive values are not drawable on a log axis), so the
 *   flags are threaded through for consistency with the visible points.
 * - Missing values are handled pairwise-complete: only rows finite in BOTH
 *   columns participate (via cellValueToNumber — `+null === 0` must never
 *   smuggle missing cells in as zeros). Fewer than 2 usable rows, or zero
 *   variance in either column, yields null ("no defined correlation").
 */

export type CorrelationKind = 'pearson' | 'spearman';

export interface CorrelationResult {
    /** Correlation coefficient in [-1, 1]. */
    r: number;
    /** Number of pairwise-complete rows that participated. */
    n: number;
}

/**
 * Pearson r recovered from an existing regression fit:
 * r = sign(slope)·√r². Returns null for a null fit (degenerate x) and for
 * the constant-y case (slope 0 with r² reported as 1 by fitRegression),
 * where the correlation is 0/0-undefined.
 */
export function pearsonFromFit(fit: RegressionFit | null): CorrelationResult | null {
    if (!fit) return null;
    // fitRegression reports a constant-y fit as slope 0, r² 1 (zero
    // residual). Pearson is undefined there (zero variance in y).
    if (fit.slope === 0 && fit.r2 === 1) return null;
    return { r: Math.sign(fit.slope) * Math.sqrt(fit.r2), n: fit.n };
}

/**
 * Pearson correlation of yCol vs xCol over the pairwise-complete rows,
 * in transformed space when the corresponding axis is log (see module doc).
 */
export function pearsonCorrelation(
    data: DataPoint[],
    xCol: string,
    yCol: string,
    xLog = false,
    yLog = false
): CorrelationResult | null {
    return pearsonFromFit(fitRegression(data, xCol, yCol, xLog, yLog));
}

/**
 * Average ranks (1-based) with ties sharing their mean rank:
 * [10, 20, 20, 30] → [1, 2.5, 2.5, 4].
 */
export function rankTransform(values: number[]): number[] {
    const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
    const ranks = new Array<number>(values.length);
    let i = 0;
    while (i < order.length) {
        let j = i;
        while (j + 1 < order.length && values[order[j + 1]] === values[order[i]]) j++;
        const avgRank = (i + j) / 2 + 1;
        for (let k = i; k <= j; k++) ranks[order[k]] = avgRank;
        i = j + 1;
    }
    return ranks;
}

/** Pearson of two equal-length numeric arrays; null when undefined. */
function pearsonOfArrays(xs: number[], ys: number[]): number | null {
    const n = xs.length;
    if (n < 2) return null;

    let sumX = 0;
    let sumY = 0;
    for (let i = 0; i < n; i++) {
        sumX += xs[i];
        sumY += ys[i];
    }
    const meanX = sumX / n;
    const meanY = sumY / n;

    // Two-pass, mean-centered accumulation (same rationale as fitRegression:
    // the one-pass form catastrophically cancels for large-offset data).
    let varX = 0;
    let varY = 0;
    let cov = 0;
    for (let i = 0; i < n; i++) {
        const dx = xs[i] - meanX;
        const dy = ys[i] - meanY;
        varX += dx * dx;
        varY += dy * dy;
        cov += dx * dy;
    }

    // Reject zero-variance columns; thresholds mirror fitRegression's
    // noise-floor analysis (centered sums for a constant column round to
    // ~eps²·mean², far below 1e-24·max(1, mean²)·n).
    if (!(varX > 1e-24 * Math.max(1, meanX * meanX) * n)) return null;
    if (!(varY > 1e-24 * Math.max(1, meanY * meanY) * n)) return null;

    const r = cov / Math.sqrt(varX * varY);
    return Math.max(-1, Math.min(1, r));
}

/**
 * Spearman rank correlation over the pairwise-complete rows. xLog/yLog only
 * affect which rows participate (non-positive values are excluded on a log
 * axis, matching the drawable point set); ranks are transform-invariant.
 */
export function spearmanCorrelation(
    data: DataPoint[],
    xCol: string,
    yCol: string,
    xLog = false,
    yLog = false
): CorrelationResult | null {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const d of data) {
        const x = cellValueToNumber(d[xCol]);
        const y = cellValueToNumber(d[yCol]);
        if (!isFinite(x) || !isFinite(y)) continue;
        if (xLog && x <= 0) continue;
        if (yLog && y <= 0) continue;
        xs.push(x);
        ys.push(y);
    }
    if (xs.length < 2) return null;

    const r = pearsonOfArrays(rankTransform(xs), rankTransform(ys));
    return r === null ? null : { r, n: xs.length };
}

/** Dispatch on the metric kind (raw values; no log transforms). */
export function computeCorrelation(
    data: DataPoint[],
    xCol: string,
    yCol: string,
    kind: CorrelationKind
): CorrelationResult | null {
    return kind === 'spearman'
        ? spearmanCorrelation(data, xCol, yCol)
        : pearsonCorrelation(data, xCol, yCol);
}

/**
 * Border-tint opacity for a given |r|: 0 → 0 (fully transparent),
 * 1 → 0.8 (strong), with a ^1.5 ease so weak correlations stay near
 * invisible and never fight the selection/brush visuals.
 */
export function correlationBorderAlpha(absR: number): number {
    if (!isFinite(absR)) return 0;
    const clamped = Math.max(0, Math.min(1, absR));
    return Math.pow(clamped, 1.5) * 0.8;
}

/**
 * Pure column sort for "sort columns by correlation" (issue #36): visible
 * columns are reordered by their mean absolute correlation against every
 * other visible column, descending; hidden columns keep their slots, and
 * ties keep their original relative order (stable sort).
 *
 * Correlations are computed on raw values (or ranks for Spearman) — the
 * sort is a structural operation, independent of per-axis scale settings.
 * Pairs with no defined correlation (fewer than 2 complete rows, zero
 * variance) contribute nothing; a column with no defined pair at all sorts
 * last. Returns a new array routed through the same setColumns path as
 * drag-reorder, so reorder state stays consistent.
 *
 * `visibleNames` optionally overrides Column.visible — App passes the
 * display-filtered visibility so an active column filter constrains the
 * sort to what is actually on screen.
 */
export function sortColumnsByCorrelation(
    columns: Column[],
    data: DataPoint[],
    kind: CorrelationKind = 'pearson',
    visibleNames?: Set<string>
): Column[] {
    const isVisible = (col: Column) =>
        visibleNames ? visibleNames.has(col.name) : col.visible;

    const visibleSlots: number[] = [];
    columns.forEach((col, index) => {
        if (isVisible(col)) visibleSlots.push(index);
    });
    if (visibleSlots.length < 2) return columns;

    const visible = visibleSlots.map(slot => columns[slot]);
    const k = visible.length;
    const sums = new Array<number>(k).fill(0);
    const counts = new Array<number>(k).fill(0);
    for (let i = 0; i < k; i++) {
        for (let j = i + 1; j < k; j++) {
            const result = computeCorrelation(data, visible[i].name, visible[j].name, kind);
            if (result === null) continue;
            const absR = Math.abs(result.r);
            sums[i] += absR;
            counts[i]++;
            sums[j] += absR;
            counts[j]++;
        }
    }

    const score = (i: number) => (counts[i] > 0 ? sums[i] / counts[i] : -Infinity);
    const order = visible.map((_, i) => i).sort((a, b) => {
        const sa = score(a);
        const sb = score(b);
        return sa === sb ? 0 : sb - sa; // avoid Infinity − Infinity = NaN
    });

    const next = [...columns];
    order.forEach((visIdx, position) => {
        next[visibleSlots[position]] = visible[visIdx];
    });
    return next;
}
