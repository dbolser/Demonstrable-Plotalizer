import { describe, it, expect } from 'vitest';
import {
  clampTableHeight,
  computeDragHeight,
  isTableVisible,
  computeRowWindow,
  TABLE_MIN_HEIGHT,
  TABLE_MAX_CONTAINER_FRACTION,
  TABLE_ROW_HEIGHT,
  TABLE_OVERSCAN,
} from '../utils/tableLayout';

describe('clampTableHeight (issue #49)', () => {
  it('passes through heights inside the allowed range', () => {
    expect(clampTableHeight(300, 1000)).toBe(300);
    expect(clampTableHeight(TABLE_MIN_HEIGHT, 1000)).toBe(TABLE_MIN_HEIGHT);
  });

  it('clamps below the minimum to TABLE_MIN_HEIGHT', () => {
    expect(clampTableHeight(0, 1000)).toBe(TABLE_MIN_HEIGHT);
    expect(clampTableHeight(-500, 1000)).toBe(TABLE_MIN_HEIGHT);
    expect(clampTableHeight(TABLE_MIN_HEIGHT - 1, 1000)).toBe(TABLE_MIN_HEIGHT);
  });

  it('clamps above the maximum to 70% of the container', () => {
    const container = 1000;
    const expectedMax = Math.floor(container * TABLE_MAX_CONTAINER_FRACTION);
    expect(clampTableHeight(5000, container)).toBe(expectedMax);
    expect(clampTableHeight(expectedMax + 1, container)).toBe(expectedMax);
  });

  it('never collapses below the minimum, even in a tiny container', () => {
    // 70% of 50px is below the minimum; the minimum wins.
    expect(clampTableHeight(300, 50)).toBe(TABLE_MIN_HEIGHT);
    expect(clampTableHeight(10, 50)).toBe(TABLE_MIN_HEIGHT);
  });

  it('rounds fractional pointer-derived heights to whole pixels', () => {
    expect(clampTableHeight(300.6, 1000)).toBe(301);
    expect(clampTableHeight(300.4, 1000)).toBe(300);
  });
});

describe('computeDragHeight (issue #49)', () => {
  it('grows the table when the pointer moves up', () => {
    // Anchor: height 300, pointer at y=500. Pointer moves up to y=400.
    expect(computeDragHeight(300, 500, 400)).toBe(400);
  });

  it('shrinks the table when the pointer moves down', () => {
    expect(computeDragHeight(300, 500, 600)).toBe(200);
  });

  it('returns the anchor height when the pointer has not moved', () => {
    expect(computeDragHeight(300, 500, 500)).toBe(300);
  });

  it('is a pure function of the absolute pointer position (no drift)', () => {
    // Simulate a wander: down 200, up 300, back to 80px above the start.
    // Only the final pointer position matters — intermediate moves cannot
    // accumulate error the way incremental-delta implementations do.
    const startHeight = 250;
    const startY = 600;
    const path = [700, 650, 400, 520];
    let height = 0;
    for (const y of path) {
      height = computeDragHeight(startHeight, startY, y);
    }
    expect(height).toBe(computeDragHeight(startHeight, startY, 520));
    expect(height).toBe(330);
  });
});

describe('isTableVisible (issue #56 visibility matrix)', () => {
  it('toggle OFF + no selection -> hidden', () => {
    expect(isTableVisible(false, false)).toBe(false);
  });

  it('toggle OFF + selection -> shown (selection auto-shows the table)', () => {
    expect(isTableVisible(false, true)).toBe(true);
  });

  it('toggle ON + no selection -> shown (full dataset)', () => {
    expect(isTableVisible(true, false)).toBe(true);
  });

  it('toggle ON + selection -> shown (selected rows)', () => {
    expect(isTableVisible(true, true)).toBe(true);
  });
});

describe('computeRowWindow (windowed table rendering, replaces the 1,000-row cap)', () => {
  // Explicit rowHeight/overscan in most tests so the expectations are
  // hand-computable; a couple of tests exercise the defaults.

  it('renders from row 0 with no top spacer when scrolled to the top', () => {
    const w = computeRowWindow(0, 400, 10000, 40, 5);
    expect(w.start).toBe(0);
    expect(w.padTop).toBe(0);
    // 400/40 = 10 visible + 1 partial + 5 overscan = 16.
    expect(w.end).toBe(16);
    expect(w.padBottom).toBe((10000 - 16) * 40);
  });

  it('windows the middle of the dataset with spacers on both sides', () => {
    // scrollTop 4000 / 40 = first row 100.
    const w = computeRowWindow(4000, 400, 10000, 40, 5);
    expect(w.start).toBe(95); // 100 - overscan
    expect(w.end).toBe(116); // 100 + 10 + 1 + 5
    expect(w.padTop).toBe(95 * 40);
    expect(w.padBottom).toBe((10000 - 116) * 40);
  });

  it('accounts for a partially scrolled row (non-multiple scrollTop)', () => {
    // scrollTop 4010 still starts at row 100 (row 100 is partially visible).
    const w = computeRowWindow(4010, 400, 10000, 40, 5);
    expect(w.start).toBe(95);
    expect(w.end).toBe(116);
  });

  it('clamps at the end of the dataset with no bottom spacer', () => {
    const total = 100;
    const w = computeRowWindow(total * 40, 400, total, 40, 5);
    expect(w.end).toBe(total);
    expect(w.padBottom).toBe(0);
    expect(w.start).toBeLessThan(total);
  });

  it('spacer heights + rendered rows always add up to the full scroll height', () => {
    const total = 30000;
    for (const scrollTop of [0, 37, 1234, 599940, 30000 * 37]) {
      const w = computeRowWindow(scrollTop, 500, total);
      const rendered = (w.end - w.start) * TABLE_ROW_HEIGHT;
      expect(w.padTop + rendered + w.padBottom).toBe(total * TABLE_ROW_HEIGHT);
    }
  });

  it('keeps the DOM row count ~constant regardless of dataset size', () => {
    const small = computeRowWindow(0, 400, 100, 40, 5);
    const huge = computeRowWindow(600000, 400, 1_000_000, 40, 5);
    const domRows = (w: { start: number; end: number }) => w.end - w.start;
    expect(domRows(huge)).toBeLessThanOrEqual(10 + 1 + 2 * 5);
    expect(domRows(small)).toBeLessThanOrEqual(10 + 1 + 2 * 5);
  });

  it('renders everything (no spacers) when the dataset fits in the viewport', () => {
    const w = computeRowWindow(0, 400, 5, 40, 5);
    expect(w).toEqual({ start: 0, end: 5, padTop: 0, padBottom: 0 });
  });

  it('handles an empty dataset', () => {
    expect(computeRowWindow(0, 400, 0)).toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0 });
    expect(computeRowWindow(500, 400, 0)).toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0 });
  });

  it('clamps a stale scrollTop after the dataset shrinks', () => {
    // Scrolled deep into 30k rows, then the data becomes 50 rows (e.g. a
    // brush selection replaced the full dataset).
    const w = computeRowWindow(30000 * 40, 400, 50, 40, 5);
    expect(w.start).toBeGreaterThanOrEqual(0);
    expect(w.start).toBeLessThan(50);
    expect(w.end).toBe(50);
    expect(w.padBottom).toBe(0);
  });

  it('clamps negative overscroll (rubber-banding) to the top', () => {
    const w = computeRowWindow(-120, 400, 1000, 40, 5);
    expect(w.start).toBe(0);
    expect(w.padTop).toBe(0);
  });

  it('treats a zero/negative viewport as rendering only overscan + first row', () => {
    const w = computeRowWindow(0, 0, 1000, 40, 5);
    expect(w.start).toBe(0);
    expect(w.end).toBe(6); // 0 visible + 1 partial + 5 overscan
  });

  it('uses TABLE_ROW_HEIGHT and TABLE_OVERSCAN as defaults', () => {
    const w = computeRowWindow(TABLE_ROW_HEIGHT * 50, 370, 10000);
    expect(w.start).toBe(50 - TABLE_OVERSCAN);
    expect(w.end).toBe(50 + Math.ceil(370 / TABLE_ROW_HEIGHT) + 1 + TABLE_OVERSCAN);
    expect(w.padTop).toBe((50 - TABLE_OVERSCAN) * TABLE_ROW_HEIGHT);
  });
});
