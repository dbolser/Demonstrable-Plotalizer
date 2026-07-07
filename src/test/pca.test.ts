import { describe, it, expect } from 'vitest';
import type { DataPoint } from '../../types';
import {
  computePCA,
  projectPCA,
  jacobiEigenDecomposition,
  PCA_COLUMN_NAMES,
} from '../utils/pca';

function makeData(rows: Array<Record<string, number | string>>): DataPoint[] {
  return rows.map((row, i) => ({ ...row, __id: i }));
}

function measureExecutionTime<T>(fn: () => T): { result: T; time: number } {
  const start = performance.now();
  const result = fn();
  const end = performance.now();
  return { result, time: end - start };
}

describe('jacobiEigenDecomposition', () => {
  it('diagonalizes a known symmetric 2x2 matrix', () => {
    // [[2, 1], [1, 2]] has eigenvalues 3 and 1 with eigenvectors
    // (1,1)/sqrt(2) and (1,-1)/sqrt(2).
    const { eigenvalues, eigenvectors } = jacobiEigenDecomposition(
      new Float64Array([2, 1, 1, 2]),
      2
    );

    expect(eigenvalues[0]).toBeCloseTo(3, 10);
    expect(eigenvalues[1]).toBeCloseTo(1, 10);

    const invSqrt2 = 1 / Math.SQRT2;
    expect(Math.abs(eigenvectors[0][0])).toBeCloseTo(invSqrt2, 10);
    expect(Math.abs(eigenvectors[0][1])).toBeCloseTo(invSqrt2, 10);
    // Same-signed components for the (1,1) direction.
    expect(Math.sign(eigenvectors[0][0])).toBe(Math.sign(eigenvectors[0][1]));
    // Opposite-signed components for the (1,-1) direction.
    expect(Math.abs(eigenvectors[1][0])).toBeCloseTo(invSqrt2, 10);
    expect(Math.sign(eigenvectors[1][0])).not.toBe(Math.sign(eigenvectors[1][1]));
  });

  it('returns unit-norm, mutually orthogonal eigenvectors for a 3x3 matrix', () => {
    const matrix = new Float64Array([4, 1, 0.5, 1, 3, 0.25, 0.5, 0.25, 2]);
    const { eigenvalues, eigenvectors } = jacobiEigenDecomposition(matrix, 3);

    // Trace is preserved.
    const trace = eigenvalues[0] + eigenvalues[1] + eigenvalues[2];
    expect(trace).toBeCloseTo(9, 8);
    // Sorted descending.
    expect(eigenvalues[0]).toBeGreaterThanOrEqual(eigenvalues[1]);
    expect(eigenvalues[1]).toBeGreaterThanOrEqual(eigenvalues[2]);

    for (let a = 0; a < 3; a++) {
      let norm = 0;
      for (let i = 0; i < 3; i++) norm += eigenvectors[a][i] ** 2;
      expect(norm).toBeCloseTo(1, 8);
      for (let b = a + 1; b < 3; b++) {
        let dot = 0;
        for (let i = 0; i < 3; i++) dot += eigenvectors[a][i] * eigenvectors[b][i];
        expect(Math.abs(dot)).toBeLessThan(1e-8);
      }
    }
  });
});

describe('computePCA', () => {
  it('recovers perfect correlation for points along y = 2x', () => {
    // In raw space PC1 is proportional to (1, 2)/sqrt(5); after z-scoring
    // both columns are the identical standardized variable, so the
    // correlation matrix is [[1, 1], [1, 1]] with eigenvalues 2 and 0 and
    // PC1 direction (1, 1)/sqrt(2) in standardized space.
    const data = makeData(
      [1, 2, 3, 4, 5].map(x => ({ x, y: 2 * x }))
    );
    const result = computePCA(data, ['x', 'y']);
    expect(result).not.toBeNull();

    expect(result!.fittedRowCount).toBe(5);
    expect(result!.eigenvalues[0]).toBeCloseTo(2, 8);
    expect(result!.eigenvalues[1]).toBeCloseTo(0, 8);
    expect(result!.explainedVarianceRatios[0]).toBeCloseTo(1, 8);
    expect(result!.explainedVarianceRatios[1]).toBeCloseTo(0, 8);

    const invSqrt2 = 1 / Math.SQRT2;
    expect(result!.eigenvectors[0][0]).toBeCloseTo(invSqrt2, 8);
    expect(result!.eigenvectors[0][1]).toBeCloseTo(invSqrt2, 8);

    // Hand-computed statistics: mean x = 3, sd x = sqrt(2.5).
    expect(result!.means[0]).toBeCloseTo(3, 10);
    expect(result!.means[1]).toBeCloseTo(6, 10);
    expect(result!.stds[0]).toBeCloseTo(Math.sqrt(2.5), 10);
    expect(result!.stds[1]).toBeCloseTo(Math.sqrt(10), 10);

    // Scores: PC1 = (zx + zy)/sqrt(2) = sqrt(2) * zx.
    const scores = projectPCA(data, result!, 2);
    const sd = Math.sqrt(2.5);
    [1, 2, 3, 4, 5].forEach((x, i) => {
      expect(scores[0][i]).toBeCloseTo((Math.SQRT2 * (x - 3)) / sd, 8);
      expect(scores[1][i]).toBeCloseTo(0, 8);
    });
  });

  it('matches hand-computed eigenvalues 1 ± r for a correlated 2-column dataset', () => {
    // For 2 standardized columns with correlation r, the correlation matrix
    // [[1, r], [r, 1]] has eigenvalues 1 + r and 1 - r.
    const xs = [0, 1, 2, 3, 4, 5, 6, 7];
    const ys = [0.2, 0.9, 2.3, 2.8, 4.4, 4.9, 6.1, 6.8];
    const data = makeData(xs.map((x, i) => ({ x, y: ys[i] })));

    // Hand-compute Pearson r.
    const n = xs.length;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    for (let i = 0; i < n; i++) {
      sxy += (xs[i] - mx) * (ys[i] - my);
      sxx += (xs[i] - mx) ** 2;
      syy += (ys[i] - my) ** 2;
    }
    const r = sxy / Math.sqrt(sxx * syy);

    const result = computePCA(data, ['x', 'y']);
    expect(result).not.toBeNull();
    expect(result!.eigenvalues[0]).toBeCloseTo(1 + r, 8);
    expect(result!.eigenvalues[1]).toBeCloseTo(1 - r, 8);
    expect(result!.explainedVarianceRatios[0]).toBeCloseTo((1 + r) / 2, 8);
  });

  it('excludes rows with missing values from the fit and mean-imputes on projection', () => {
    const data = makeData([
      { x: 1, y: 2 },
      { x: 2, y: 4 },
      { x: 'oops', y: 6 }, // non-numeric -> excluded from fit
      { x: 4, y: NaN }, // NaN -> excluded from fit
      { x: 3, y: 6 },
    ]);
    const result = computePCA(data, ['x', 'y']);
    expect(result).not.toBeNull();
    // Only the 3 complete rows are fitted; mean x over (1, 2, 3) = 2.
    expect(result!.fittedRowCount).toBe(3);
    expect(result!.means[0]).toBeCloseTo(2, 10);

    // Projection covers ALL rows, with missing values imputed to the mean.
    const scores = projectPCA(data, result!, 2);
    expect(scores[0].length).toBe(5);
    for (let i = 0; i < 5; i++) {
      expect(Number.isFinite(scores[0][i])).toBe(true);
    }
    // Row 2 ('oops', 6): zx imputed to 0, zy = 1 -> PC1 = (0 + 1)/sqrt(2).
    expect(scores[0][2]).toBeCloseTo(1 / Math.SQRT2, 8);
  });

  it('handles sparse arrays / undefined rows without throwing', () => {
    const data = makeData([
      { x: 1, y: 2 },
      { x: 2, y: 4 },
      { x: 3, y: 6 },
      { x: 4, y: 8 },
    ]);
    // Simulate a sparse/undefined entry (e.g. a hole in the array).
    (data as (DataPoint | undefined)[])[2] = undefined;

    const result = computePCA(data, ['x', 'y']);
    expect(result).not.toBeNull();
    // The undefined row is treated as incomplete and excluded from the fit.
    expect(result!.fittedRowCount).toBe(3);

    // Projection still yields a finite (fully mean-imputed => 0) score.
    const scores = projectPCA(data, result!, 2);
    expect(scores[0].length).toBe(4);
    expect(scores[0][2]).toBe(0);
    for (let i = 0; i < 4; i++) {
      expect(Number.isFinite(scores[0][i])).toBe(true);
    }
  });

  it('skips zero-variance columns', () => {
    const data = makeData([
      { x: 1, y: 2, constant: 7 },
      { x: 2, y: 4, constant: 7 },
      { x: 3, y: 5, constant: 7 },
      { x: 4, y: 9, constant: 7 },
    ]);
    const result = computePCA(data, ['x', 'y', 'constant']);
    expect(result).not.toBeNull();
    expect(result!.skippedColumns).toEqual(['constant']);
    expect(result!.columnNames).toEqual(['x', 'y']);
    expect(result!.eigenvalues.length).toBe(2);
  });

  it('returns null when there are not enough usable columns or rows', () => {
    const oneColumn = makeData([{ x: 1 }, { x: 2 }, { x: 3 }]);
    expect(computePCA(oneColumn, ['x'])).toBeNull();

    const allConstant = makeData([
      { x: 1, y: 5 },
      { x: 1, y: 5 },
      { x: 1, y: 5 },
    ]);
    expect(computePCA(allConstant, ['x', 'y'])).toBeNull();

    const tooFewRows = makeData([{ x: 1, y: 2 }]);
    expect(computePCA(tooFewRows, ['x', 'y'])).toBeNull();

    const noCompleteRows = makeData([
      { x: NaN, y: 2 },
      { x: 1, y: 'n/a' },
    ]);
    expect(computePCA(noCompleteRows, ['x', 'y'])).toBeNull();
  });

  it('exposes stable derived column names', () => {
    expect(PCA_COLUMN_NAMES).toEqual(['PC1', 'PC2', 'PC3']);
  });
});

describe('PCA performance', () => {
  function createLargeDataset(rows: number, cols: number): { data: DataPoint[]; columnNames: string[] } {
    const columnNames = Array.from({ length: cols }, (_, i) => `col_${i + 1}`);
    const data: DataPoint[] = Array.from({ length: rows }, (_, i) => {
      const point: DataPoint = { __id: i };
      // Correlated structure so the decomposition is non-trivial.
      const latent = Math.random();
      columnNames.forEach((name, j) => {
        point[name] = latent * (j + 1) + Math.random() * 10;
      });
      return point;
    });
    return { data, columnNames };
  }

  it('fits and projects 30k rows x 30 columns in under 1 second', () => {
    const { data, columnNames } = createLargeDataset(30000, 30);

    const { result, time } = measureExecutionTime(() => {
      const model = computePCA(data, columnNames);
      if (!model) throw new Error('PCA unexpectedly returned null');
      const scores = projectPCA(data, model, 3);
      return { model, scores };
    });

    expect(time).toBeLessThan(1000); // 1s budget for fit + projection
    expect(result.model.eigenvalues.length).toBe(30);
    expect(result.scores.length).toBe(3);
    expect(result.scores[0].length).toBe(30000);
    // Eigenvalue trace of a 30-column correlation matrix is 30.
    const trace = Array.from(result.model.eigenvalues).reduce((a, b) => a + b, 0);
    expect(trace).toBeCloseTo(30, 4);
  });
});
