import { describe, it, expect } from 'vitest';
import {
    pearsonCorrelation,
    pearsonFromFit,
    spearmanCorrelation,
    rankTransform,
    computeCorrelation,
    correlationBorderAlpha,
    sortColumnsByCorrelation,
} from '../utils/correlationUtils';
import { restoreColumnOrder } from '../utils/columnUtils';
import { buildRenderKey } from '../utils/renderKeyUtils';
import type { RenderKeyParts } from '../utils/renderKeyUtils';
import type { Column, DataPoint } from '../../types';

const rows = (points: Array<[number | null, number | null]>): DataPoint[] =>
    points.map(([x, y], i) => ({ __id: i, x, y } as unknown as DataPoint));

const col = (name: string, visible = true): Column => ({ name, scale: 'linear', visible });

describe('pearsonCorrelation', () => {
    it('matches the hand-computed value for a positive relationship', () => {
        // Points (1,2),(2,3),(3,5),(4,4):
        //   cov = 1.0, varX = varY = 1.25 → r = 1 / √(1.25·1.25) = 0.8
        const result = pearsonCorrelation(rows([[1, 2], [2, 3], [3, 5], [4, 4]]), 'x', 'y');
        expect(result).not.toBeNull();
        expect(result!.r).toBeCloseTo(0.8, 10);
        expect(result!.n).toBe(4);
    });

    it('matches the hand-computed value for a negative relationship', () => {
        // Points (1,5),(2,4),(3,2),(4,3):
        //   cov = -1.0, varX = varY = 1.25 → r = -0.8
        const result = pearsonCorrelation(rows([[1, 5], [2, 4], [3, 2], [4, 3]]), 'x', 'y');
        expect(result).not.toBeNull();
        expect(result!.r).toBeCloseTo(-0.8, 10);
    });

    it('returns exactly ±1 for perfectly linear data', () => {
        expect(pearsonCorrelation(rows([[1, 3], [2, 5], [3, 7]]), 'x', 'y')!.r).toBeCloseTo(1, 10);
        expect(pearsonCorrelation(rows([[1, 9], [2, 7], [3, 5]]), 'x', 'y')!.r).toBeCloseTo(-1, 10);
    });

    it('computes in transformed space when an axis is log', () => {
        // u = log10(x) = 1, 2, 3 against y = 5, 8, 11: perfectly linear.
        const result = pearsonCorrelation(rows([[10, 5], [100, 8], [1000, 11]]), 'x', 'y', true, false);
        expect(result).not.toBeNull();
        expect(result!.r).toBeCloseTo(1, 10);
    });

    it('is undefined (null) for constant columns and n < 2', () => {
        expect(pearsonCorrelation(rows([[4, 1], [4, 2], [4, 3]]), 'x', 'y')).toBeNull(); // constant x
        expect(pearsonCorrelation(rows([[1, 5], [2, 5], [3, 5]]), 'x', 'y')).toBeNull(); // constant y
        expect(pearsonCorrelation(rows([[1, 2]]), 'x', 'y')).toBeNull();
        expect(pearsonCorrelation([], 'x', 'y')).toBeNull();
    });

    it('handles missing values pairwise-complete (null is not zero)', () => {
        // The (null, 100) row would wreck r if null coerced to x = 0;
        // the (5, null) row likewise. Only the 4 complete rows participate.
        const data = rows([[1, 2], [2, 3], [null, 100], [3, 5], [4, 4], [5, null]]);
        const result = pearsonCorrelation(data, 'x', 'y');
        expect(result).not.toBeNull();
        expect(result!.n).toBe(4);
        expect(result!.r).toBeCloseTo(0.8, 10);
    });
});

describe('pearsonFromFit', () => {
    it('returns null for a null fit', () => {
        expect(pearsonFromFit(null)).toBeNull();
    });

    it('returns null for the constant-y fit (slope 0, r² reported as 1)', () => {
        expect(pearsonFromFit({ slope: 0, intercept: 5, r2: 1, n: 3 })).toBeNull();
    });

    it('recovers r = sign(slope)·√r²', () => {
        expect(pearsonFromFit({ slope: -2, intercept: 0, r2: 0.64, n: 10 }))
            .toEqual({ r: -0.8, n: 10 });
        expect(pearsonFromFit({ slope: 0.5, intercept: 1, r2: 0.25, n: 7 }))
            .toEqual({ r: 0.5, n: 7 });
    });
});

describe('rankTransform', () => {
    it('assigns average ranks to ties', () => {
        expect(rankTransform([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
    });

    it('keeps input order (ranks are positional)', () => {
        expect(rankTransform([30, 10, 20])).toEqual([3, 1, 2]);
    });

    it('handles all-tied and empty inputs', () => {
        expect(rankTransform([5, 5, 5])).toEqual([2, 2, 2]);
        expect(rankTransform([])).toEqual([]);
    });
});

describe('spearmanCorrelation', () => {
    it('is ±1 for monotone (even nonlinear) relationships', () => {
        const up = rows([[1, Math.E], [2, Math.E ** 2], [3, Math.E ** 3], [4, Math.E ** 4]]);
        expect(spearmanCorrelation(up, 'x', 'y')!.r).toBeCloseTo(1, 10);
        const down = rows([[1, 1], [2, 1 / 2], [3, 1 / 3], [4, 1 / 4]]);
        expect(spearmanCorrelation(down, 'x', 'y')!.r).toBeCloseTo(-1, 10);
    });

    it('matches Pearson-on-ranks by hand with ties', () => {
        // x ranks [1,2,3,4]; y = [10,30,30,50] → ranks [1,2.5,2.5,4]
        //   cov = 1.125, varX = 1.25, varY = 1.125 → ρ = √(1.125/1.25) = √0.9
        const result = spearmanCorrelation(rows([[1, 10], [2, 30], [3, 30], [4, 50]]), 'x', 'y');
        expect(result).not.toBeNull();
        expect(result!.r).toBeCloseTo(Math.sqrt(0.9), 10);
        expect(result!.n).toBe(4);
    });

    it('handles missing values pairwise-complete', () => {
        const data = rows([[1, 1], [2, 4], [null, 999], [3, 9], [4, null], [4.5, 20]]);
        const result = spearmanCorrelation(data, 'x', 'y');
        expect(result).not.toBeNull();
        expect(result!.n).toBe(4);
        expect(result!.r).toBeCloseTo(1, 10);
    });

    it('excludes non-positive values on a log axis (matching drawable points)', () => {
        const data = rows([[-1, 999], [0, 998], [1, 1], [10, 2], [100, 3]]);
        const result = spearmanCorrelation(data, 'x', 'y', true, false);
        expect(result).not.toBeNull();
        expect(result!.n).toBe(3);
        expect(result!.r).toBeCloseTo(1, 10);
    });

    it('is undefined (null) for all-tied columns and n < 2', () => {
        expect(spearmanCorrelation(rows([[1, 5], [2, 5], [3, 5]]), 'x', 'y')).toBeNull();
        expect(spearmanCorrelation(rows([[1, 2]]), 'x', 'y')).toBeNull();
    });
});

describe('computeCorrelation (metric dispatch)', () => {
    it('routes to the requested metric', () => {
        // Nonlinear monotone: Pearson < 1, Spearman = 1.
        const data = rows([[1, 1], [2, 4], [3, 9], [4, 100]]);
        expect(computeCorrelation(data, 'x', 'y', 'spearman')!.r).toBeCloseTo(1, 10);
        expect(computeCorrelation(data, 'x', 'y', 'pearson')!.r).toBeLessThan(1);
    });
});

describe('correlationBorderAlpha', () => {
    it('maps |r| 0 → transparent and 1 → strong', () => {
        expect(correlationBorderAlpha(0)).toBe(0);
        expect(correlationBorderAlpha(1)).toBeCloseTo(0.8, 10);
    });

    it('is monotone and clamped', () => {
        expect(correlationBorderAlpha(0.3)).toBeLessThan(correlationBorderAlpha(0.7));
        expect(correlationBorderAlpha(2)).toBeCloseTo(0.8, 10);
        expect(correlationBorderAlpha(NaN)).toBe(0);
    });
});

describe('sortColumnsByCorrelation', () => {
    // Known matrix: b = 2a (|r| = 1); c is exactly orthogonal to both
    // (cov(a, c) = cov(b, c) = 0). Mean |r|: a = b = 0.5, c = 0.
    const data: DataPoint[] = [
        { __id: 0, a: 1, b: 2, c: 1 },
        { __id: 1, a: 2, b: 4, c: -1 },
        { __id: 2, a: 3, b: 6, c: -1 },
        { __id: 3, a: 4, b: 8, c: 1 },
    ];

    it('orders visible columns by mean |r| descending, stable on ties', () => {
        const sorted = sortColumnsByCorrelation([col('c'), col('a'), col('b')], data);
        // a and b tie at 0.5 → keep their original relative order (a first).
        expect(sorted.map(c => c.name)).toEqual(['a', 'b', 'c']);
    });

    it('leaves hidden columns in their original slots', () => {
        const hidden = col('h', false);
        const sorted = sortColumnsByCorrelation([col('c'), hidden, col('a'), col('b')], data);
        expect(sorted.map(c => c.name)).toEqual(['a', 'h', 'b', 'c']);
        expect(sorted[1]).toBe(hidden);
    });

    it('sorts columns with no defined correlation last', () => {
        const dataWithNulls = data.map(d => ({ ...d, z: null } as unknown as DataPoint));
        const sorted = sortColumnsByCorrelation([col('z'), col('a'), col('b')], dataWithNulls);
        expect(sorted.map(c => c.name)).toEqual(['a', 'b', 'z']);
    });

    it('respects a visibleNames override (column-filter view)', () => {
        // x duplicates a's values: if visibleNames were ignored it would sort
        // to the front; instead it must stay in slot 1 untouched.
        const dataWithX = data.map(d => ({ ...d, x: d.a } as DataPoint));
        const sorted = sortColumnsByCorrelation(
            [col('c'), col('x'), col('a'), col('b')],
            dataWithX,
            'pearson',
            new Set(['c', 'a', 'b'])
        );
        expect(sorted.map(c => c.name)).toEqual(['a', 'x', 'b', 'c']);
    });

    it('supports Spearman as the sort metric', () => {
        // y = a³ is monotone: Spearman |ρ| = 1 with a, Pearson < 1.
        const cubic = data.map(d => ({ ...d, y: (d.a as number) ** 3 } as DataPoint));
        const sorted = sortColumnsByCorrelation([col('c'), col('y'), col('a')], cubic, 'spearman');
        expect(sorted.map(c => c.name)).toEqual(['y', 'a', 'c']);
    });

    it('returns the input unchanged with fewer than 2 visible columns', () => {
        const columns = [col('a'), col('b', false)];
        expect(sortColumnsByCorrelation(columns, data)).toBe(columns);
    });
});

describe('restoreColumnOrder', () => {
    it('restores the saved order', () => {
        const a = col('a');
        const b = col('b');
        const c = col('c');
        expect(restoreColumnOrder([c, a, b], [a, b, c])).toEqual([a, b, c]);
    });

    it('keeps the CURRENT column objects (edits after the sort survive)', () => {
        const savedB = col('b'); // was visible when saved
        const editedB = col('b', false); // hidden since
        const restored = restoreColumnOrder([editedB, col('a')], [col('a'), savedB]);
        expect(restored.map(c => c.name)).toEqual(['a', 'b']);
        expect(restored[1]).toBe(editedB);
        expect(restored[1].visible).toBe(false);
    });

    it('appends columns unknown to the saved order at the end, in current relative order', () => {
        const restored = restoreColumnOrder(
            [col('PC1'), col('c'), col('PC2'), col('a')],
            [col('a'), col('c')]
        );
        expect(restored.map(c => c.name)).toEqual(['a', 'c', 'PC1', 'PC2']);
    });
});

describe('buildRenderKey (correlation cache correctness)', () => {
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
        showCorrelation: false,
        tintCellBorders: false,
        correlationMetric: 'pearson',
        colorStateHash: 'none',
    };

    it('changes when the correlation badge toggle changes', () => {
        expect(buildRenderKey({ ...base, showCorrelation: true })).not.toBe(buildRenderKey(base));
    });

    it('changes when the border tint toggle changes', () => {
        expect(buildRenderKey({ ...base, tintCellBorders: true })).not.toBe(buildRenderKey(base));
    });

    it('changes with the metric while a correlation feature is active', () => {
        const on = { ...base, showCorrelation: true };
        expect(buildRenderKey({ ...on, correlationMetric: 'spearman' })).not.toBe(buildRenderKey(on));
        const tint = { ...base, tintCellBorders: true };
        expect(buildRenderKey({ ...tint, correlationMetric: 'spearman' })).not.toBe(buildRenderKey(tint));
    });

    it('ignores the metric while both correlation toggles are off (no pixel effect)', () => {
        expect(buildRenderKey({ ...base, correlationMetric: 'spearman' })).toBe(buildRenderKey(base));
    });

    it('distinguishes all four correlation toggle combinations', () => {
        const keys = new Set(
            [
                [false, false],
                [true, false],
                [false, true],
                [true, true],
            ].map(([badge, tint]) =>
                buildRenderKey({ ...base, showCorrelation: badge, tintCellBorders: tint })
            )
        );
        expect(keys.size).toBe(4);
    });
});
