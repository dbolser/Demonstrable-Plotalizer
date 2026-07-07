import { describe, it, expect } from 'vitest';
import type { DataPoint } from '../../types';
import {
  CATEGORY_PALETTE,
  MISSING_SLOT,
  MISSING_COLOR,
  RAINBOW_BUCKETS,
  buildRainbowColors,
  computeCategorySlots,
  computeRainbowSlots,
  computeColorState,
  computeColorStateHash,
} from '../utils/colorUtils';
import { buildRenderKey } from '../utils/renderKeyUtils';

// Shared CI runners are slow and noisy; local threshold is the real target.
const CI_FACTOR = process.env.CI ? 8 : 1;

const makeRows = (values: (string | number | null)[], key = 'v'): DataPoint[] =>
  values.map((v, i) => {
    const row: DataPoint = { __id: i };
    if (v !== null) row[key] = v as string | number;
    return row;
  });

describe('computeCategorySlots', () => {
  it('assigns palette slots by first appearance and maps rows correctly', () => {
    const data = makeRows(['b', 'a', 'b', 'c', 'a']);
    const { slotById, categories } = computeCategorySlots(data, 'v');

    expect(categories.map(c => c.name)).toEqual(['b', 'a', 'c']);
    expect(categories[0].color).toBe(CATEGORY_PALETTE[0]);
    expect(categories[1].color).toBe(CATEGORY_PALETTE[1]);
    expect(Array.from(slotById)).toEqual([0, 1, 0, 2, 1]);
  });

  it('marks missing / empty values with the missing sentinel', () => {
    const data = makeRows(['a', null, '', 'b']);
    const { slotById } = computeCategorySlots(data, 'v');
    expect(slotById[0]).toBe(0);
    expect(slotById[1]).toBe(MISSING_SLOT);
    expect(slotById[2]).toBe(MISSING_SLOT);
    expect(slotById[3]).toBe(1);
  });

  it('cycles the palette beyond 10 categories', () => {
    const values = Array.from({ length: 13 }, (_, i) => `cat${i}`);
    const data = makeRows(values);
    const { slotById, categories } = computeCategorySlots(data, 'v');

    expect(categories).toHaveLength(13);
    // 11th category reuses the 1st palette color
    expect(slotById[10]).toBe(0);
    expect(categories[10].color).toBe(CATEGORY_PALETTE[0]);
    expect(slotById[12]).toBe(2);
  });
});

describe('computeRainbowSlots', () => {
  it('file order: buckets increase monotonically with row position', () => {
    const data = makeRows(Array.from({ length: 100 }, (_, i) => i));
    const slots = computeRainbowSlots(data, null);

    expect(slots[0]).toBe(0);
    expect(slots[99]).toBe(RAINBOW_BUCKETS - 1);
    for (let i = 1; i < 100; i++) {
      expect(slots[i]).toBeGreaterThanOrEqual(slots[i - 1]);
    }
  });

  it('column rank: gradient follows sorted rank, not file order', () => {
    // values are reversed: highest value is in row 0
    const data = makeRows([30, 20, 10, 0]);
    const slots = computeRainbowSlots(data, 'v');

    // row 3 has the lowest value -> gradient start; row 0 the highest -> end
    expect(slots[3]).toBe(0);
    expect(slots[0]).toBe(RAINBOW_BUCKETS - 1);
    expect(slots[3]).toBeLessThan(slots[2]);
    expect(slots[2]).toBeLessThan(slots[1]);
    expect(slots[1]).toBeLessThan(slots[0]);
  });

  it('breaks ties by original row order (stable)', () => {
    const data = makeRows([5, 5, 5, 5]);
    const slots = computeRainbowSlots(data, 'v');
    for (let i = 1; i < 4; i++) {
      expect(slots[i]).toBeGreaterThanOrEqual(slots[i - 1]);
    }
    expect(slots[0]).toBe(0);
    expect(slots[3]).toBe(RAINBOW_BUCKETS - 1);
  });

  it('treats stored null / empty-string cells as missing, not rank zero', () => {
    // PapaParse (dynamicTyping) stores blank cells as null; +null === 0, so
    // without an explicit null check these rows would join the rank as
    // zero-valued instead of getting the neutral-gray sentinel.
    const data: DataPoint[] = [
      { __id: 0, v: 10 },
      { __id: 1, v: null as unknown as number },
      { __id: 2, v: '' },
      { __id: 3, v: '   ' },
      { __id: 4, v: -5 },
    ];
    const slots = computeRainbowSlots(data, 'v');

    expect(slots[1]).toBe(MISSING_SLOT);
    expect(slots[2]).toBe(MISSING_SLOT);
    expect(slots[3]).toBe(MISSING_SLOT);
    // rank spans only the two finite rows: -5 -> start, 10 -> end
    expect(slots[4]).toBe(0);
    expect(slots[0]).toBe(RAINBOW_BUCKETS - 1);
  });

  it('gives NaN / missing rows the neutral-gray sentinel, excluded from rank', () => {
    const data = makeRows([10, NaN, 5, null, 20]);
    const slots = computeRainbowSlots(data, 'v');

    expect(slots[1]).toBe(MISSING_SLOT);
    expect(slots[3]).toBe(MISSING_SLOT);
    // ranks computed over the 3 finite rows only
    expect(slots[2]).toBe(0);
    expect(slots[4]).toBe(RAINBOW_BUCKETS - 1);
    expect(slots[0]).toBeGreaterThan(slots[2]);
    expect(slots[0]).toBeLessThan(slots[4]);
  });
});

describe('computeColorState', () => {
  it('returns null for mode none, empty data, or category mode without a column', () => {
    const data = makeRows(['a', 'b']);
    expect(computeColorState(data, 'none', 'v', null)).toBeNull();
    expect(computeColorState([], 'rainbow', null, null)).toBeNull();
    expect(computeColorState(data, 'category', null, null)).toBeNull();
  });

  it('builds rainbow slot colors with the viridis gradient', () => {
    const data = makeRows([1, 2, 3]);
    const state = computeColorState(data, 'rainbow', null, null);
    expect(state).not.toBeNull();
    expect(state!.slotColors).toHaveLength(RAINBOW_BUCKETS);
    expect(state!.slotColors).toEqual(buildRainbowColors());
    expect(state!.slotColors[0]).not.toBe(state!.slotColors[RAINBOW_BUCKETS - 1]);
    expect(MISSING_COLOR).toMatch(/^#/);
  });

  it('hash reflects mode, category column, ordering column and palette version', () => {
    const hashes = [
      computeColorStateHash('none', null, null),
      computeColorStateHash('category', 'species', null),
      computeColorStateHash('category', 'region', null),
      computeColorStateHash('rainbow', null, null),
      computeColorStateHash('rainbow', null, 'depth'),
    ];
    expect(new Set(hashes).size).toBe(hashes.length);
  });
});

describe('render cache key includes color state', () => {
  const baseParts = {
    xColName: 'x',
    yColName: 'y',
    xScale: 'linear',
    yScale: 'linear',
    filterMode: 'highlight',
    dataStateHash: 'v1-100-0-99',
    selectedStateHash: 'none',
    size: 150,
    showIdentityLine: false,
    showRegressionLine: false,
  };

  it('changes the render key when the color mode changes', () => {
    const keyNone = buildRenderKey({ ...baseParts, colorStateHash: computeColorStateHash('none', null, null) });
    const keyRainbow = buildRenderKey({ ...baseParts, colorStateHash: computeColorStateHash('rainbow', null, null) });
    const keyCategory = buildRenderKey({ ...baseParts, colorStateHash: computeColorStateHash('category', 'species', null) });

    expect(keyNone).not.toEqual(keyRainbow);
    expect(keyNone).not.toEqual(keyCategory);
    expect(keyRainbow).not.toEqual(keyCategory);
  });

  it('changes the render key when the rainbow ordering column changes', () => {
    const fileOrder = buildRenderKey({ ...baseParts, colorStateHash: computeColorStateHash('rainbow', null, null) });
    const ranked = buildRenderKey({ ...baseParts, colorStateHash: computeColorStateHash('rainbow', null, 'depth') });
    expect(fileOrder).not.toEqual(ranked);
  });

  it('matches the ColorState.hash produced by computeColorState', () => {
    const data = makeRows([1, 2, 3]);
    const state = computeColorState(data, 'rainbow', null, 'v');
    expect(state!.hash).toBe(computeColorStateHash('rainbow', null, 'v'));
  });
});

describe('color index precompute performance', () => {
  it('builds 30k-row color indices in under 50ms', () => {
    const n = 30000;
    const data: DataPoint[] = Array.from({ length: n }, (_, i) => ({
      __id: i,
      v: Math.random() * 1000,
      cat: `group_${i % 25}`,
    }));

    // Warm-up pass (JIT), then best-of-3: the suite runs files in parallel
    // workers, so a single raw measurement is dominated by scheduler noise.
    const bestOf3 = (fn: () => void): number => {
      let best = Infinity;
      for (let run = 0; run < 3; run++) {
        const start = performance.now();
        fn();
        best = Math.min(best, performance.now() - start);
      }
      return best;
    };

    computeRainbowSlots(data, 'v');
    computeCategorySlots(data, 'cat');

    const rankTime = bestOf3(() => computeRainbowSlots(data, 'v'));
    const categoryTime = bestOf3(() => computeCategorySlots(data, 'cat'));

    expect(rankTime).toBeLessThan(50 * CI_FACTOR);
    expect(categoryTime).toBeLessThan(50 * CI_FACTOR);
  });
});
