import type { DataPoint } from '../../types';

/**
 * Principal Component Analysis over selected numeric columns.
 *
 * Pipeline: standardize (z-score) -> covariance matrix (= correlation matrix
 * of the raw data, since the inputs are standardized) -> eigendecomposition
 * via cyclic Jacobi rotations (dependency-free; the matrix is d x d where d
 * is the number of columns, so this is fast even for ~100 columns).
 *
 * Missing-value policy:
 * - FIT: rows with any non-finite/non-numeric value in the selected columns
 *   are excluded from the fit (means, stds, covariance).
 * - PROJECTION: every row gets a score; missing values are mean-imputed,
 *   i.e. they contribute z = 0 for that column.
 * - Zero-variance columns are skipped (they carry no information and would
 *   divide by zero when standardizing).
 */

/** Names used for the derived PCA columns added to the matrix. */
export const PCA_COLUMN_NAMES = ['PC1', 'PC2', 'PC3'] as const;

export type PCAResult = {
  /** Columns actually used in the fit (zero-variance columns removed). */
  columnNames: string[];
  /** Selected columns that were skipped because they have (near-)zero variance. */
  skippedColumns: string[];
  /** Per-column mean over the fitted rows (aligned with columnNames). */
  means: Float64Array;
  /** Per-column standard deviation over the fitted rows (aligned with columnNames). */
  stds: Float64Array;
  /** Eigenvalues of the correlation matrix, sorted descending. */
  eigenvalues: Float64Array;
  /**
   * Unit eigenvectors in standardized space, sorted to match eigenvalues.
   * eigenvectors[k][j] is the loading of columnNames[j] on component k.
   */
  eigenvectors: Float64Array[];
  /** Fraction of total variance explained by each component, sorted descending. */
  explainedVarianceRatios: number[];
  /** Number of complete rows the model was fitted on. */
  fittedRowCount: number;
};

const ZERO_VARIANCE_EPS = 1e-12;

function toFiniteNumber(value: number | string | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : NaN;
}

/**
 * Eigendecomposition of a symmetric n x n matrix (row-major Float64Array)
 * using the cyclic Jacobi rotation method. Returns eigenvalues sorted
 * descending and the matching unit eigenvectors (each of length n).
 * Eigenvector signs are normalized so the largest-magnitude entry is positive.
 */
export function jacobiEigenDecomposition(
  matrix: Float64Array,
  n: number
): { eigenvalues: Float64Array; eigenvectors: Float64Array[] } {
  // Work on a copy; accumulate rotations into V (starts as identity).
  const a = new Float64Array(matrix);
  const v = new Float64Array(n * n);
  for (let i = 0; i < n; i++) v[i * n + i] = 1;

  const MAX_SWEEPS = 100;
  for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
    // Sum of squared off-diagonal elements — convergence check.
    let off = 0;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) off += a[p * n + q] * a[p * n + q];
    }
    if (off < 1e-20) break;

    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p * n + q];
        if (Math.abs(apq) < 1e-30) continue;

        const app = a[p * n + p];
        const aqq = a[q * n + q];
        const theta = (aqq - app) / (2 * apq);
        // tan of the rotation angle, choosing the smaller rotation.
        const t =
          Math.sign(theta) / (Math.abs(theta) + Math.sqrt(theta * theta + 1)) ||
          1 / (theta + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;

        // Update rows/columns p and q of A (A stays symmetric).
        for (let k = 0; k < n; k++) {
          const akp = a[k * n + p];
          const akq = a[k * n + q];
          a[k * n + p] = c * akp - s * akq;
          a[k * n + q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p * n + k];
          const aqk = a[q * n + k];
          a[p * n + k] = c * apk - s * aqk;
          a[q * n + k] = s * apk + c * aqk;
        }
        // Accumulate the rotation into the eigenvector matrix.
        for (let k = 0; k < n; k++) {
          const vkp = v[k * n + p];
          const vkq = v[k * n + q];
          v[k * n + p] = c * vkp - s * vkq;
          v[k * n + q] = s * vkp + c * vkq;
        }
      }
    }
  }

  // Extract, sort descending by eigenvalue, normalize signs.
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (i, j) => a[j * n + j] - a[i * n + i]
  );
  const eigenvalues = new Float64Array(n);
  const eigenvectors: Float64Array[] = [];
  for (let rank = 0; rank < n; rank++) {
    const col = order[rank];
    eigenvalues[rank] = a[col * n + col];
    const vec = new Float64Array(n);
    let maxAbs = 0;
    let maxVal = 0;
    for (let i = 0; i < n; i++) {
      vec[i] = v[i * n + col];
      if (Math.abs(vec[i]) > maxAbs) {
        maxAbs = Math.abs(vec[i]);
        maxVal = vec[i];
      }
    }
    if (maxVal < 0) {
      for (let i = 0; i < n; i++) vec[i] = -vec[i];
    }
    eigenvectors.push(vec);
  }
  return { eigenvalues, eigenvectors };
}

/**
 * Fit a PCA model on the given columns of the dataset.
 * Returns null if there are fewer than 2 usable columns or fewer than 2
 * complete rows to fit on.
 */
export function computePCA(data: DataPoint[], columnNames: string[]): PCAResult | null {
  const n = data.length;
  const dAll = columnNames.length;
  if (n < 2 || dAll < 2) return null;

  // Extract values into a flat typed array (row-major), tracking complete rows.
  const raw = new Float64Array(n * dAll);
  const rowComplete = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const row = data[i];
    // Guard against sparse arrays / undefined rows: treat them as incomplete.
    let complete = row ? 1 : 0;
    const base = i * dAll;
    for (let j = 0; j < dAll; j++) {
      const value = row ? toFiniteNumber(row[columnNames[j]]) : NaN;
      raw[base + j] = value;
      if (Number.isNaN(value)) complete = 0;
    }
    rowComplete[i] = complete;
  }

  const fitRows: number[] = [];
  for (let i = 0; i < n; i++) if (rowComplete[i]) fitRows.push(i);
  const m = fitRows.length;
  if (m < 2) return null;

  // Means and stds over complete rows only.
  const meansAll = new Float64Array(dAll);
  for (let r = 0; r < m; r++) {
    const base = fitRows[r] * dAll;
    for (let j = 0; j < dAll; j++) meansAll[j] += raw[base + j];
  }
  for (let j = 0; j < dAll; j++) meansAll[j] /= m;

  const varsAll = new Float64Array(dAll);
  for (let r = 0; r < m; r++) {
    const base = fitRows[r] * dAll;
    for (let j = 0; j < dAll; j++) {
      const dev = raw[base + j] - meansAll[j];
      varsAll[j] += dev * dev;
    }
  }
  for (let j = 0; j < dAll; j++) varsAll[j] /= m - 1;

  // Drop zero-variance columns.
  const usedIdx: number[] = [];
  const skippedColumns: string[] = [];
  for (let j = 0; j < dAll; j++) {
    if (varsAll[j] > ZERO_VARIANCE_EPS) usedIdx.push(j);
    else skippedColumns.push(columnNames[j]);
  }
  const d = usedIdx.length;
  if (d < 2) return null;

  const means = new Float64Array(d);
  const stds = new Float64Array(d);
  const usedNames: string[] = [];
  for (let j = 0; j < d; j++) {
    means[j] = meansAll[usedIdx[j]];
    stds[j] = Math.sqrt(varsAll[usedIdx[j]]);
    usedNames.push(columnNames[usedIdx[j]]);
  }

  // Standardize fitted rows (column-major so covariance dot products stream
  // contiguously) then compute the covariance of the z-scores.
  const z = new Float64Array(m * d);
  for (let j = 0; j < d; j++) {
    const src = usedIdx[j];
    const mean = means[j];
    const invStd = 1 / stds[j];
    const colBase = j * m;
    for (let r = 0; r < m; r++) {
      z[colBase + r] = (raw[fitRows[r] * dAll + src] - mean) * invStd;
    }
  }

  const cov = new Float64Array(d * d);
  const invM1 = 1 / (m - 1);
  for (let j = 0; j < d; j++) {
    const colJ = j * m;
    for (let k = j; k < d; k++) {
      const colK = k * m;
      let sum = 0;
      for (let r = 0; r < m; r++) sum += z[colJ + r] * z[colK + r];
      const value = sum * invM1;
      cov[j * d + k] = value;
      cov[k * d + j] = value;
    }
  }

  const { eigenvalues, eigenvectors } = jacobiEigenDecomposition(cov, d);

  // Total variance of standardized data = trace of the correlation matrix = d.
  // Clamp tiny negative eigenvalues (numerical noise) to zero for the ratios.
  let total = 0;
  for (let k = 0; k < d; k++) total += Math.max(0, eigenvalues[k]);
  const explainedVarianceRatios = Array.from(eigenvalues, ev =>
    total > 0 ? Math.max(0, ev) / total : 0
  );

  return {
    columnNames: usedNames,
    skippedColumns,
    means,
    stds,
    eigenvalues,
    eigenvectors,
    explainedVarianceRatios,
    fittedRowCount: m,
  };
}

/**
 * Project every row of the dataset onto the first `numComponents` principal
 * components. Missing/non-numeric values are mean-imputed (z = 0), so every
 * row receives a finite score.
 *
 * Returns scores[k][i] = score of row i on component k.
 */
export function projectPCA(
  data: DataPoint[],
  result: PCAResult,
  numComponents: number
): Float64Array[] {
  const n = data.length;
  const d = result.columnNames.length;
  const k = Math.max(0, Math.min(numComponents, result.eigenvectors.length));

  const scores: Float64Array[] = [];
  for (let c = 0; c < k; c++) scores.push(new Float64Array(n));

  const zRow = new Float64Array(d);
  for (let i = 0; i < n; i++) {
    const row = data[i];
    for (let j = 0; j < d; j++) {
      // Guard against sparse arrays / undefined rows: mean-impute (z = 0).
      const value = row ? toFiniteNumber(row[result.columnNames[j]]) : NaN;
      // Mean imputation: a missing value standardizes to exactly 0.
      zRow[j] = Number.isNaN(value) ? 0 : (value - result.means[j]) / result.stds[j];
    }
    for (let c = 0; c < k; c++) {
      const vec = result.eigenvectors[c];
      let sum = 0;
      for (let j = 0; j < d; j++) sum += zRow[j] * vec[j];
      scores[c][i] = sum;
    }
  }
  return scores;
}
