import { describe, it, expect } from 'vitest';
import type { DataPoint } from '../../types';
import {
  buildColumnStore,
  buildSelectedFlags,
  computeVectorStats,
  collectFiniteValues,
  selectIdsInValueRange,
} from '../utils/columnStore';
import {
  createSpatialGrid,
  getPointsInBrush,
  createSpatialGridFromColumns,
  getPointsInBrushFromColumns,
} from '../utils/selectionUtils';

// Matches the perf-test convention: local thresholds are the target, CI
// runners get headroom.
const CI_FACTOR = process.env.CI ? 8 : 1;

function makeRows(rows: number, cols: number, missingEvery = 0): DataPoint[] {
  return Array.from({ length: rows }, (_, i) => {
    const row: DataPoint = { __id: i };
    for (let c = 0; c < cols; c++) {
      row[`col_${c}`] =
        missingEvery > 0 && (i + c) % missingEvery === 0 ? '' : (i * 31 + c * 7) % 997;
    }
    return row;
  });
}

describe('buildColumnStore', () => {
  const data: DataPoint[] = [
    { __id: 0, a: 5, b: -2, s: 'x' },
    { __id: 1, a: '3.5', b: null as unknown as number, s: 'y' },
    { __id: 2, a: '', b: 0.25, s: 'z' },
    { __id: 3, a: 'abc', b: 10, s: 'w' },
    { __id: 4, a: 0, b: '  ', s: 'v' },
  ];

  it('stores numeric values with NaN for missing/blank/non-numeric cells', () => {
    const store = buildColumnStore(data, ['a', 'b']);
    expect(store.length).toBe(5);
    expect(Array.from(store.columns.get('a')!.values.slice(0, 2))).toEqual([5, 3.5]);
    expect(store.columns.get('a')!.values[2]).toBeNaN(); // ''
    expect(store.columns.get('a')!.values[3]).toBeNaN(); // 'abc'
    expect(store.columns.get('a')!.values[4]).toBe(0);
    expect(store.columns.get('b')!.values[1]).toBeNaN(); // null
    expect(store.columns.get('b')!.values[4]).toBeNaN(); // blank string
  });

  it('maps store rows to __ids via rowIds (array order, not id order)', () => {
    const shuffled = [data[3], data[0], data[4]];
    const store = buildColumnStore(shuffled, ['a']);
    expect(Array.from(store.rowIds)).toEqual([3, 0, 4]);
    expect(store.columns.get('a')!.values[1]).toBe(5); // row __id 0
  });

  it('computes min/max/minPositive/finiteCount in the build pass', () => {
    const store = buildColumnStore(data, ['a', 'b']);
    const a = store.columns.get('a')!;
    expect(a.min).toBe(0);
    expect(a.max).toBe(5);
    expect(a.minPositive).toBe(3.5);
    expect(a.finiteCount).toBe(3);
    const b = store.columns.get('b')!;
    expect(b.min).toBe(-2);
    expect(b.max).toBe(10);
    expect(b.minPositive).toBe(0.25);
    expect(b.finiteCount).toBe(3);
  });

  it('yields Infinity sentinels for a column with no finite values', () => {
    const store = buildColumnStore(data, ['s']);
    const s = store.columns.get('s')!;
    expect(s.min).toBe(Infinity);
    expect(s.max).toBe(-Infinity);
    expect(s.minPositive).toBe(Infinity);
    expect(s.finiteCount).toBe(0);
  });

  it('deduplicates repeated column names', () => {
    const store = buildColumnStore(data, ['a', 'a', 'b']);
    expect(store.columns.size).toBe(2);
  });

  it('matches the legacy per-render row-scan stats on random data', () => {
    const rows = makeRows(2000, 3, 7);
    const store = buildColumnStore(rows, ['col_0', 'col_1', 'col_2']);
    for (const name of ['col_0', 'col_1', 'col_2']) {
      let min = Infinity, max = -Infinity, minPositive = Infinity;
      for (const row of rows) {
        const v = +row[name];
        if (row[name] === '' || !Number.isFinite(v)) continue;
        if (v < min) min = v;
        if (v > max) max = v;
        if (v > 0 && v < minPositive) minPositive = v;
      }
      const vec = store.columns.get(name)!;
      expect(vec.min).toBe(min);
      expect(vec.max).toBe(max);
      expect(vec.minPositive).toBe(minPositive);
    }
  });
});

describe('buildSelectedFlags / computeVectorStats / collectFiniteValues', () => {
  const rows = makeRows(100, 2, 9);
  const store = buildColumnStore(rows, ['col_0', 'col_1']);

  it('returns null for an empty selection', () => {
    expect(buildSelectedFlags(store, new Set())).toBeNull();
  });

  it('flags exactly the selected store rows', () => {
    const flags = buildSelectedFlags(store, new Set([2, 50, 99]))!;
    expect(flags.length).toBe(100);
    expect(flags[2]).toBe(1);
    expect(flags[50]).toBe(1);
    expect(flags[99]).toBe(1);
    expect(Array.from(flags).reduce((a, b) => a + b, 0)).toBe(3);
  });

  it('computeVectorStats(null flags) returns the prebuilt full-column stats', () => {
    const vec = store.columns.get('col_0')!;
    expect(computeVectorStats(vec, null)).toEqual({
      min: vec.min,
      max: vec.max,
      minPositive: vec.minPositive,
    });
  });

  it('computeVectorStats over a flagged subset matches a manual scan', () => {
    const ids = new Set([1, 3, 5, 7, 11]);
    const flags = buildSelectedFlags(store, ids)!;
    const vec = store.columns.get('col_1')!;
    const subsetVals = rows
      .filter(r => ids.has(r.__id) && r['col_1'] !== '')
      .map(r => +r['col_1']);
    const stats = computeVectorStats(vec, flags);
    expect(stats.min).toBe(Math.min(...subsetVals));
    expect(stats.max).toBe(Math.max(...subsetVals));
    expect(stats.minPositive).toBe(Math.min(...subsetVals.filter(v => v > 0)));
  });

  it('computeVectorStats minPositive over a flagged subset ignores zero/negative values', () => {
    const negRows: DataPoint[] = [
      { __id: 0, v: -5 },
      { __id: 1, v: 0 },
      { __id: 2, v: 4 },
      { __id: 3, v: 2 },
      { __id: 4, v: 0.5 }, // deliberately NOT flagged: must not become minPositive
    ];
    const s = buildColumnStore(negRows, ['v']);
    const flags = buildSelectedFlags(s, new Set([0, 1, 2, 3]))!;
    expect(computeVectorStats(s.columns.get('v')!, flags)).toEqual({
      min: -5,
      max: 4,
      minPositive: 2,
    });
  });

  it('collectFiniteValues skips NaN and honors flags', () => {
    const vec = store.columns.get('col_0')!;
    const all = collectFiniteValues(vec);
    expect(all.length).toBe(vec.finiteCount);
    expect(all.every(Number.isFinite)).toBe(true);

    const flags = buildSelectedFlags(store, new Set([0, 1, 2]))!;
    const some = collectFiniteValues(vec, flags);
    const expected = rows.slice(0, 3).filter(r => r['col_0'] !== '').length;
    expect(some.length).toBe(expected);
  });
});

describe('selectIdsInValueRange', () => {
  it('selects ids by value range and never matches NaN (missing) cells', () => {
    const rows: DataPoint[] = [
      { __id: 0, v: 0 },
      { __id: 1, v: 5 },
      { __id: 2, v: '' },     // old +coercion would have made this 0
      { __id: 3, v: 10 },
      { __id: 4, v: null as unknown as number },
    ];
    const store = buildColumnStore(rows, ['v']);
    const vec = store.columns.get('v')!;
    expect(selectIdsInValueRange(store, vec, 0, 5)).toEqual(new Set([0, 1]));
    expect(selectIdsInValueRange(store, vec, -100, 100)).toEqual(new Set([0, 1, 3]));
  });
});

describe('columnar spatial grid parity', () => {
  it('matches the row-object grid/brush results exactly', () => {
    const rows = makeRows(3000, 2, 13);
    const store = buildColumnStore(rows, ['col_0', 'col_1']);
    const size = 150;
    const xScale = (v: number) => (v / 997) * size;
    const yScale = (v: number) => size - (v / 997) * size;

    const legacyGrid = createSpatialGrid(rows, xScale, yScale, 'col_0', 'col_1', size);
    const legacyIds = getPointsInBrush(
      legacyGrid, xScale, yScale, 20, 30, 90, 120, 'col_0', 'col_1', size
    );

    const xVec = store.columns.get('col_0')!.values;
    const yVec = store.columns.get('col_1')!.values;
    const grid = createSpatialGridFromColumns(xVec, yVec, xScale, yScale, size);
    const ids = getPointsInBrushFromColumns(
      grid, xVec, yVec, store.rowIds, xScale, yScale, 20, 30, 90, 120, size
    );

    expect(ids).toEqual(legacyIds);
    expect(ids.size).toBeGreaterThan(0);
  });
});

describe('column store performance', () => {
  it('builds a 30k x 30 store (with stats) in under 150ms', () => {
    const rows = makeRows(30000, 30);
    const names = Array.from({ length: 30 }, (_, c) => `col_${c}`);
    const start = performance.now();
    const store = buildColumnStore(rows, names);
    const elapsed = performance.now() - start;
    expect(store.length).toBe(30000);
    expect(store.columns.size).toBe(30);
    expect(elapsed).toBeLessThan(150 * CI_FACTOR);
  });

  it('rebuilds selection flags for 30k rows in under 20ms', () => {
    const rows = makeRows(30000, 1);
    const store = buildColumnStore(rows, ['col_0']);
    const selected = new Set(Array.from({ length: 10000 }, (_, i) => i * 3));
    const start = performance.now();
    const flags = buildSelectedFlags(store, selected)!;
    const elapsed = performance.now() - start;
    expect(flags.reduce((a: number, b) => a + b, 0)).toBe(10000);
    expect(elapsed).toBeLessThan(20 * CI_FACTOR);
  });
});
