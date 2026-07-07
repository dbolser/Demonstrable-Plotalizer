import { describe, it, expect } from 'vitest';
import * as d3 from 'd3';
import type { DataPoint } from '../../types';
import { computeColorState, CATEGORY_PALETTE, MISSING_COLOR } from '../utils/colorUtils';
import {
  RAINBOW_STACK_BINS,
  getStackConfig,
  computeStackedBinCounts,
  buildStackSegments,
  isFiniteCellValue,
} from '../utils/histogramStackUtils';

const NO_SELECTION = new Set<number>();

/** Bin rows by a numeric column the same way the histograms do. */
const binRows = (data: DataPoint[], column: string, thresholds = 10) => {
  const rows = data.filter(d => isFiniteCellValue(d[column]));
  const values = rows.map(d => +d[column]);
  const [min, max] = d3.extent(values) as [number, number];
  return d3
    .bin<DataPoint, number>()
    .value(d => +d[column])
    .domain([min, max])
    .thresholds(thresholds)(rows);
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

describe('missing-value handling (stored nulls from PapaParse dynamicTyping)', () => {
  it('isFiniteCellValue rejects null/undefined/blank strings but accepts real zeros', () => {
    expect(isFiniteCellValue(null)).toBe(false);
    expect(isFiniteCellValue(undefined)).toBe(false);
    expect(isFiniteCellValue('')).toBe(false);
    expect(isFiniteCellValue('   ')).toBe(false);
    expect(isFiniteCellValue('abc')).toBe(false);
    expect(isFiniteCellValue(Infinity)).toBe(false);
    expect(isFiniteCellValue(NaN)).toBe(false);
    expect(isFiniteCellValue(0)).toBe(true);
    expect(isFiniteCellValue('0')).toBe(true);
    expect(isFiniteCellValue(-3.5)).toBe(true);
    expect(isFiniteCellValue('42')).toBe(true);
  });

  it('rows with null in the rainbow ordering column stack into the gray missing segment', () => {
    // Rows 8 and 9 have a stored null / blank rank cell; all rows have a
    // finite binned value, so they must appear in the histogram — but in
    // the missing segment, consistent with their gray point color.
    const data: DataPoint[] = Array.from({ length: 10 }, (_, i) => ({
      __id: i,
      v: i, // binned column: always finite
      rank: i < 8 ? i : (null as unknown as number), // color column
    }));
    (data[9] as DataPoint).rank = '  ' as unknown as number; // blank string cell

    const state = computeColorState(data, 'rainbow', null, 'rank')!;
    const config = getStackConfig(state);
    const bins = binRows(data, 'v', 5);
    const { total } = computeStackedBinCounts(bins, state, config, NO_SELECTION);

    // All 10 rows are counted, and exactly the 2 null-ranked rows are in
    // the trailing missing stack (index numStacks). None of them was
    // coerced to rank 0 (which would put them in gradient stack 0 next to
    // the genuinely lowest-ranked row).
    const grandTotal = total.flat().reduce((a, c) => a + c, 0);
    expect(grandTotal).toBe(10);
    const missingCount = total.reduce((a, stacks) => a + stacks[config.numStacks], 0);
    expect(missingCount).toBe(2);

    // The bins holding rows 8 and 9 carry the missing segment.
    const lastBin = total[total.length - 1];
    expect(lastBin[config.numStacks]).toBe(2);
    // Segment building keeps gray last, from the running cumulative total.
    const segments = buildStackSegments(total, config.stackColors);
    const graySegments = segments.filter(s => s.stackIndex === config.numStacks);
    expect(graySegments).toHaveLength(1);
    expect(graySegments[0].color).toBe(MISSING_COLOR);
    expect(graySegments[0].end - graySegments[0].start).toBe(2);
  });

  it('rows with null in the category column stack into the gray missing segment', () => {
    const data: DataPoint[] = [
      { __id: 0, cat: 'a', v: 1 },
      { __id: 1, cat: null as unknown as string, v: 1 },
      { __id: 2, cat: 'a', v: 9 },
      { __id: 3, cat: '', v: 9 },
    ];
    const state = computeColorState(data, 'category', 'cat', null)!;
    const config = getStackConfig(state);
    const bins = binRows(data, 'v', 2);
    const { total } = computeStackedBinCounts(bins, state, config, NO_SELECTION);

    expect(total[0][0]).toBe(1); // 'a'
    expect(total[0][config.numStacks]).toBe(1); // null cell -> gray
    const lastBin = total[total.length - 1];
    expect(lastBin[0]).toBe(1); // 'a'
    expect(lastBin[config.numStacks]).toBe(1); // '' cell -> gray
  });

  it('rows with null in the BINNED column are excluded, not counted as zeros', () => {
    // Regression: isFinite(+null) === isFinite(0) === true, so a plain
    // isFinite(+v) filter binned null cells as real zeros in the 0-bin.
    const data: DataPoint[] = [
      { __id: 0, v: 0, rank: 0 }, // genuine zero — must stay
      { __id: 1, v: null as unknown as number, rank: 1 },
      { __id: 2, v: '' as unknown as number, rank: 2 },
      { __id: 3, v: 10, rank: 3 },
    ];
    const state = computeColorState(data, 'rainbow', null, 'rank')!;
    const config = getStackConfig(state);
    const bins = binRows(data, 'v', 2);
    const { total } = computeStackedBinCounts(bins, state, config, NO_SELECTION);

    const grandTotal = total.flat().reduce((a, c) => a + c, 0);
    expect(grandTotal).toBe(2); // only rows 0 and 3
    const binnedIds = bins.flatMap(bin => bin.map(r => r.__id));
    expect(binnedIds.sort()).toEqual([0, 3]);
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
