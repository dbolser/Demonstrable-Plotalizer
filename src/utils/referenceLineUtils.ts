import type { DataPoint } from '../../types';
import { cellValueToNumber } from './cellValueUtils';

/**
 * Per-cell reference line helpers (issue #50).
 *
 * All math here is pure and screen-independent so it can be unit-tested
 * without a canvas: the identity segment is computed in data space, and the
 * regression is fit in *transformed* space (log10 of the data values for a
 * log axis) — which makes the fitted line straight in screen space for every
 * linear/log axis combination, since a d3 log scale's screen position is
 * affine in log10(value).
 */

export interface RegressionFit {
    /** Slope in transformed space (log10 units for log axes). */
    slope: number;
    /** Intercept in transformed space. */
    intercept: number;
    /** Coefficient of determination of the fit, in transformed space. */
    r2: number;
    /** Number of points that participated in the fit. */
    n: number;
}

/**
 * The data-space interval where the x and y domains overlap — the only span
 * where the y=x identity line is inside both axes. Returns null when the
 * domains don't overlap (or merely touch at a point, which would be a
 * zero-length segment). Domain order (ascending/descending) is normalized.
 */
export function computeIdentityOverlap(
    xDomain: [number, number],
    yDomain: [number, number]
): [number, number] | null {
    const xLo = Math.min(xDomain[0], xDomain[1]);
    const xHi = Math.max(xDomain[0], xDomain[1]);
    const yLo = Math.min(yDomain[0], yDomain[1]);
    const yHi = Math.max(yDomain[0], yDomain[1]);

    const lo = Math.max(xLo, yLo);
    const hi = Math.min(xHi, yHi);

    if (!isFinite(lo) || !isFinite(hi) || lo >= hi) return null;
    return [lo, hi];
}

/**
 * Least-squares fit of yCol on xCol over the given rows, in transformed
 * space: log10 of the value when the corresponding axis is log, the raw
 * value otherwise. Points with non-finite values — or non-positive values
 * on a log axis — are excluded.
 *
 * Returns null for degenerate fits: fewer than 2 usable points, or zero
 * variance in (transformed) x. A zero-variance-in-y fit is valid (a
 * horizontal line with zero residual, reported as r² = 1).
 */
export function fitRegression(
    data: DataPoint[],
    xCol: string,
    yCol: string,
    xLog: boolean,
    yLog: boolean
): RegressionFit | null {
    // Two-pass, mean-centered accumulation: the one-pass E[XY] − E[X]E[Y]
    // form suffers catastrophic cancellation when values are far from zero
    // relative to their spread (timestamps, genomic coordinates, ...), which
    // can silently skew the slope or spuriously reject the fit.
    const points: Array<[number, number]> = [];
    for (const d of data) {
        // cellValueToNumber, not +raw: `+null === 0`, which would silently
        // include rows with missing cells as real zeros (issue #36 requires
        // pairwise-complete handling).
        const x = cellValueToNumber(d[xCol]);
        const y = cellValueToNumber(d[yCol]);
        if (!isFinite(x) || !isFinite(y)) continue;
        if (xLog && x <= 0) continue;
        if (yLog && y <= 0) continue;
        points.push([xLog ? Math.log10(x) : x, yLog ? Math.log10(y) : y]);
    }

    const n = points.length;
    if (n < 2) return null;

    let sumU = 0;
    let sumW = 0;
    for (const [u, w] of points) {
        sumU += u;
        sumW += w;
    }
    const meanU = sumU / n;
    const meanW = sumW / n;

    // Population (co)variances; the 1/n factors cancel in slope and r².
    let varU = 0;
    let varW = 0;
    let covUW = 0;
    for (const [u, w] of points) {
        const du = u - meanU;
        const dw = w - meanW;
        varU += du * du;
        varW += dw * dw;
        covUW += du * dw;
    }
    varU /= n;
    varW /= n;
    covUW /= n;

    // Reject constant-x fits. With centered sums the rounding noise for a
    // truly constant column is bounded by ~eps² · meanU² (eps ≈ 2.2e-16), so
    // a 1e-24 relative threshold sits far above the noise floor while still
    // admitting genuine relative spreads down to ~1e-12 of the mean.
    if (!(varU > 1e-24 * Math.max(1, meanU * meanU))) return null;

    const slope = covUW / varU;
    const intercept = meanW - slope * meanU;
    // varW === 0 means every residual is zero (horizontal line): perfect fit.
    const r2 = varW > 0 ? Math.min(1, (covUW * covUW) / (varU * varW)) : 1;

    return { slope, intercept, r2, n };
}
