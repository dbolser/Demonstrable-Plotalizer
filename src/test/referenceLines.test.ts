import { describe, it, expect } from 'vitest';
import { computeIdentityOverlap, fitRegression } from '../utils/referenceLineUtils';
import { buildRenderKey } from '../utils/renderKeyUtils';
import type { RenderKeyParts } from '../utils/renderKeyUtils';
import type { DataPoint } from '../../types';

const rows = (points: Array<[number, number]>): DataPoint[] =>
    points.map(([x, y], i) => ({ __id: i, x, y }));

describe('computeIdentityOverlap', () => {
    it('returns the full domain when both domains are identical', () => {
        expect(computeIdentityOverlap([0, 10], [0, 10])).toEqual([0, 10]);
    });

    it('returns the intersection for partially overlapping domains', () => {
        expect(computeIdentityOverlap([0, 10], [5, 20])).toEqual([5, 10]);
        expect(computeIdentityOverlap([5, 20], [0, 10])).toEqual([5, 10]);
    });

    it('returns the contained domain when one domain contains the other', () => {
        expect(computeIdentityOverlap([0, 100], [20, 30])).toEqual([20, 30]);
    });

    it('returns null when domains do not overlap', () => {
        expect(computeIdentityOverlap([0, 1], [2, 3])).toBeNull();
        expect(computeIdentityOverlap([10, 20], [-5, 0])).toBeNull();
    });

    it('returns null when domains merely touch at a point (zero-length segment)', () => {
        expect(computeIdentityOverlap([0, 5], [5, 10])).toBeNull();
    });

    it('normalizes descending domain order (e.g. an inverted y range)', () => {
        expect(computeIdentityOverlap([10, 0], [5, 20])).toEqual([5, 10]);
    });

    it('works for positive log-style domains', () => {
        expect(computeIdentityOverlap([0.1, 1000], [1, 50])).toEqual([1, 50]);
    });
});

describe('fitRegression (linear-linear)', () => {
    it('recovers an exact linear relationship y = 2x + 1 with r² = 1', () => {
        const fit = fitRegression(rows([[1, 3], [2, 5], [3, 7], [4, 9]]), 'x', 'y', false, false);
        expect(fit).not.toBeNull();
        expect(fit!.slope).toBeCloseTo(2, 10);
        expect(fit!.intercept).toBeCloseTo(1, 10);
        expect(fit!.r2).toBeCloseTo(1, 10);
        expect(fit!.n).toBe(4);
    });

    it('matches hand-computed values for a noisy dataset', () => {
        // Points (1,2),(2,3),(3,5),(4,4):
        //   meanX = 2.5, meanY = 3.5
        //   cov = [(-1.5)(-1.5)+(-0.5)(-0.5)+(0.5)(1.5)+(1.5)(0.5)]/4 = 1.0
        //   varX = (2.25+0.25+0.25+2.25)/4 = 1.25 → slope = 1/1.25 = 0.8
        //   intercept = 3.5 − 0.8·2.5 = 1.5
        //   varY = 1.25 → r² = cov²/(varX·varY) = 1/1.5625 = 0.64
        const fit = fitRegression(rows([[1, 2], [2, 3], [3, 5], [4, 4]]), 'x', 'y', false, false);
        expect(fit).not.toBeNull();
        expect(fit!.slope).toBeCloseTo(0.8, 10);
        expect(fit!.intercept).toBeCloseTo(1.5, 10);
        expect(fit!.r2).toBeCloseTo(0.64, 10);
    });

    it('ignores rows with non-finite values', () => {
        const data = rows([[1, 3], [2, 5], [NaN, 7], [3, NaN], [3, 7]]);
        const fit = fitRegression(data, 'x', 'y', false, false);
        expect(fit).not.toBeNull();
        expect(fit!.n).toBe(3);
        expect(fit!.slope).toBeCloseTo(2, 10);
    });

    it('fits a constant y as a horizontal line with r² = 1 (zero residual)', () => {
        const fit = fitRegression(rows([[1, 5], [2, 5], [3, 5]]), 'x', 'y', false, false);
        expect(fit).not.toBeNull();
        expect(fit!.slope).toBeCloseTo(0, 10);
        expect(fit!.intercept).toBeCloseTo(5, 10);
        expect(fit!.r2).toBe(1);
    });
});

describe('fitRegression (log axes: fit in transformed space)', () => {
    it('fits y = 3·log10(x) + 2 when x is log-scaled', () => {
        // x = 10^1, 10^2, 10^3 → u = 1, 2, 3; y = 5, 8, 11
        const fit = fitRegression(rows([[10, 5], [100, 8], [1000, 11]]), 'x', 'y', true, false);
        expect(fit).not.toBeNull();
        expect(fit!.slope).toBeCloseTo(3, 10);
        expect(fit!.intercept).toBeCloseTo(2, 10);
        expect(fit!.r2).toBeCloseTo(1, 10);
    });

    it('fits a power law (both axes log): y = x² gives slope 2 in log-log space', () => {
        const fit = fitRegression(rows([[1, 1], [10, 100], [100, 10000]]), 'x', 'y', true, true);
        expect(fit).not.toBeNull();
        expect(fit!.slope).toBeCloseTo(2, 10);
        expect(fit!.intercept).toBeCloseTo(0, 10);
    });

    it('excludes non-positive values on a log axis from the fit', () => {
        const data = rows([[10, 5], [100, 8], [-50, 999], [0, 999], [1000, 11]]);
        const fit = fitRegression(data, 'x', 'y', true, false);
        expect(fit).not.toBeNull();
        expect(fit!.n).toBe(3);
        expect(fit!.slope).toBeCloseTo(3, 10);
    });
});

describe('fitRegression (degenerate cases)', () => {
    it('returns null for fewer than 2 usable points', () => {
        expect(fitRegression([], 'x', 'y', false, false)).toBeNull();
        expect(fitRegression(rows([[1, 2]]), 'x', 'y', false, false)).toBeNull();
        // 3 rows but only 1 usable after log filtering
        expect(fitRegression(rows([[10, 5], [-1, 2], [0, 3]]), 'x', 'y', true, false)).toBeNull();
    });

    it('returns null when x has zero variance (vertical line)', () => {
        expect(fitRegression(rows([[4, 1], [4, 2], [4, 3]]), 'x', 'y', false, false)).toBeNull();
    });
});

describe('fitRegression (numerical stability)', () => {
    it('fits large-offset, small-spread data (e.g. timestamps) accurately', () => {
        // One-pass E[XY] − E[X]E[Y] accumulation catastrophically cancels
        // here (varU ≈ 8.25e5 vs meanU² ≈ 1e18) and used to reject the fit.
        const data = rows(
            Array.from({ length: 100 }, (_, i): [number, number] => [1e9 + i * 100, 2 * (1e9 + i * 100) + 1])
        );
        const fit = fitRegression(data, 'x', 'y', false, false);
        expect(fit).not.toBeNull();
        expect(fit!.slope).toBeCloseTo(2, 6);
        expect(fit!.r2).toBeCloseTo(1, 6);
    });

    it('still rejects a constant column with a large mean', () => {
        expect(fitRegression(rows([[1e9, 1], [1e9, 2], [1e9, 3]]), 'x', 'y', false, false)).toBeNull();
    });
});

describe('buildRenderKey (reference-line cache correctness)', () => {
    const base: RenderKeyParts = {
        xColName: 'a',
        yColName: 'b',
        xScale: 'linear',
        yScale: 'log',
        filterMode: 'highlight',
        dataStateHash: 'v1-100-0-99',
        selectedStateHash: 'none',
        size: 150,
        showIdentityLine: false,
        showRegressionLine: false,
        colorStateHash: 'none',
    };

    it('is stable for identical inputs', () => {
        expect(buildRenderKey(base)).toBe(buildRenderKey({ ...base }));
    });

    it('changes when the identity-line toggle changes', () => {
        expect(buildRenderKey({ ...base, showIdentityLine: true }))
            .not.toBe(buildRenderKey(base));
    });

    it('changes when the regression-line toggle changes', () => {
        expect(buildRenderKey({ ...base, showRegressionLine: true }))
            .not.toBe(buildRenderKey(base));
    });

    it('distinguishes all four toggle combinations', () => {
        const keys = new Set(
            [
                [false, false],
                [true, false],
                [false, true],
                [true, true],
            ].map(([idn, reg]) =>
                buildRenderKey({ ...base, showIdentityLine: idn, showRegressionLine: reg })
            )
        );
        expect(keys.size).toBe(4);
    });

    it('does not collide when hyphenated column names shift the field split', () => {
        expect(buildRenderKey({ ...base, xColName: 'a-b', yColName: 'c' }))
            .not.toBe(buildRenderKey({ ...base, xColName: 'a', yColName: 'b-c' }));
    });

    it('still changes with the pre-existing inputs (data, selection, scales, size)', () => {
        expect(buildRenderKey({ ...base, dataStateHash: 'v2-100-0-99' })).not.toBe(buildRenderKey(base));
        expect(buildRenderKey({ ...base, selectedStateHash: '5-12345' })).not.toBe(buildRenderKey(base));
        expect(buildRenderKey({ ...base, xScale: 'log' })).not.toBe(buildRenderKey(base));
        expect(buildRenderKey({ ...base, size: 200 })).not.toBe(buildRenderKey(base));
    });

    it('changes when the color state hash changes', () => {
        expect(buildRenderKey({ ...base, colorStateHash: 'rainbow||' }))
            .not.toBe(buildRenderKey(base));
    });
});
