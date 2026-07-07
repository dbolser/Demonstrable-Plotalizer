import { describe, it, expect } from 'vitest';
import * as d3 from 'd3';
import type { DataPoint } from '../../types';
import { computeColorState, CATEGORY_PALETTE, MISSING_COLOR } from '../utils/colorUtils';
import {
  RAINBOW_STACK_BINS,
  getStackConfig,
  computeStackedBinCounts,
  buildStackSegments,
} from '../utils/histogramStackUtils';

const NO_SELECTION = new Set<number>();

/** Bin rows by a numeric column the same way the histograms do. */
const binRows = (data: DataPoint[], column: string, thresholds = 10) => {
  const values = data.map(d => +d[column]).filter(isFinite);
  const [min, max] = d3.extent(values) as [number, number];
  return d3
    .bin<DataPoint, number>()
    .value(d => +d[column])
    .domain([min, max])
    .thresholds(thresholds)(data.filter(d => isFinite(+d[column])));
};

describe('getStackConfig', () => {
  it('buckets the rainbow gradient into RAINBOW_STACK_BINS stacks', () => {
    const data: DataPoint[] = Array.from({ length: 100 }, (_, i) => ({ __id: i, v: i }));
    const state = computeColorState(data, 'rainbow', null, null)!;
    const config = getStackConfig(state);

    expect(config.numStacks).toBe(RAINBOW_STACK_BINS);
    expect(config.stackColors).toHaveLength(RAINBOW_STACK_BINS + 1);
    expect(config.stackColors[RAINBOW_STACK_BINS]).toBe(MISSING_COLOR);
    // slot 0 -> first stack, top slot -> last stack
    expect(config.stackSlotFor(0)).toBe(0);
    expect(config.stackSlotFor(63)).toBe(RAINBOW_STACK_BINS - 1);
  });

  it('stacks category mode by palette slot', () => {
    const data: DataPoint[] = [{ __id: 0, cat: 'a' }];
    const state = computeColorState(data, 'category', 'cat', null)!;
    const config = getStackConfig(state);
    expect(config.numStacks).toBe(CATEGORY_PALETTE.length);
    expect(config.stackColors.slice(0, CATEGORY_PALETTE.length)).toEqual([...CATEGORY_PALETTE]);
  });
});

describe('computeStackedBinCounts', () => {
  it('category mode: per-bin per-category counts match manual counting', () => {
    // 3 categories, values arranged so bin membership is known
    const data: DataPoint[] = [
      { __id: 0, cat: 'a', v: 1 },
      { __id: 1, cat: 'b', v: 1 },
      { __id: 2, cat: 'a', v: 1 },
      { __id: 3, cat: 'c', v: 9 },
      { __id: 4, cat: 'a', v: 9 },
    ];
    const state = computeColorState(data, 'category', 'cat', null)!;
    const config = getStackConfig(state);
    const bins = binRows(data, 'v', 2);
    const { total } = computeStackedBinCounts(bins, state, config, NO_SELECTION);

    const firstBin = total[0];
    expect(firstBin[0]).toBe(2); // 'a'
    expect(firstBin[1]).toBe(1); // 'b'
    const lastBin = total[total.length - 1];
    expect(lastBin[0]).toBe(1); // 'a'
    expect(lastBin[2]).toBe(1); // 'c'
  });

  it('segment counts sum to the bin totals, and selection is a subset', () => {
    const data: DataPoint[] = Array.from({ length: 200 }, (_, i) => ({
      __id: i,
      v: (i * 37) % 200,
    }));
    const state = computeColorState(data, 'rainbow', null, 'v')!;
    const config = getStackConfig(state);
    const bins = binRows(data, 'v', 10);
    const selectedIds = new Set(Array.from({ length: 50 }, (_, i) => i * 3));
    const { total, selected } = computeStackedBinCounts(bins, state, config, selectedIds);

    bins.forEach((bin, b) => {
      expect(total[b].reduce((a, c) => a + c, 0)).toBe(bin.length);
      selected[b].forEach((count, s) => {
        expect(count).toBeLessThanOrEqual(total[b][s]);
      });
    });
    const selectedSum = selected.flat().reduce((a, c) => a + c, 0);
    expect(selectedSum).toBe(selectedIds.size);
  });

  it("ordering column's own histogram is a near-perfect gradient: monotonic segment ordering", () => {
    // Shuffled values; rainbow ranked by the same column that is binned.
    const n = 500;
    const data: DataPoint[] = Array.from({ length: n }, (_, i) => ({
      __id: i,
      v: (i * 271) % n, // permutation of 0..n-1
    }));
    const state = computeColorState(data, 'rainbow', null, 'v')!;
    const config = getStackConfig(state);
    const bins = binRows(data, 'v', 10);
    const { total } = computeStackedBinCounts(bins, state, config, NO_SELECTION);

    let prevMin = -1;
    let prevMax = -1;
    total.forEach(stacks => {
      const present = stacks
        .map((count, s) => ({ count, s }))
        .filter(e => e.count > 0 && e.s < config.numStacks)
        .map(e => e.s);
      if (present.length === 0) return;
      const minSlot = Math.min(...present);
      const maxSlot = Math.max(...present);

      // Within a bin the ranks are contiguous, so the color slots must be too.
      for (let s = minSlot; s <= maxSlot; s++) {
        expect(stacks[s]).toBeGreaterThan(0);
      }
      // Across bins (sorted by value) the gradient must advance monotonically.
      expect(minSlot).toBeGreaterThanOrEqual(prevMin);
      expect(maxSlot).toBeGreaterThanOrEqual(prevMax);
      prevMin = minSlot;
      prevMax = maxSlot;
    });
    // The gradient spans its full range across the histogram.
    const firstPresent = total.find(stacks => stacks.some(c => c > 0))!;
    const lastPresent = [...total].reverse().find(stacks => stacks.some(c => c > 0))!;
    expect(firstPresent[0]).toBeGreaterThan(0);
    expect(lastPresent[config.numStacks - 1]).toBeGreaterThan(0);
  });
});

describe('buildStackSegments', () => {
  it('emits cumulative segments from the baseline in stack order, skipping empties', () => {
    const counts = [
      [3, 0, 2, 1],
      [0, 0, 0, 0],
    ];
    const colors = ['c0', 'c1', 'c2', 'gray'];
    const segments = buildStackSegments(counts, colors);

    expect(segments).toEqual([
      { binIndex: 0, stackIndex: 0, start: 0, end: 3, color: 'c0' },
      { binIndex: 0, stackIndex: 2, start: 3, end: 5, color: 'c2' },
      { binIndex: 0, stackIndex: 3, start: 5, end: 6, color: 'gray' },
    ]);
  });
});
