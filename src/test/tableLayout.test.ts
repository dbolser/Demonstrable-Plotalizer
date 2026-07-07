import { describe, it, expect } from 'vitest';
import {
  clampTableHeight,
  computeDragHeight,
  isTableVisible,
  capTableRows,
  TABLE_MIN_HEIGHT,
  TABLE_MAX_CONTAINER_FRACTION,
  TABLE_ROW_CAP,
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

describe('capTableRows (issue #56 full-dataset cap)', () => {
  const makeRows = (n: number) => Array.from({ length: n }, (_, i) => ({ __id: i }));

  it('returns all rows and no note when at or below the cap', () => {
    const under = makeRows(10);
    expect(capTableRows(under)).toEqual({ rows: under, capNote: null });

    const exact = makeRows(TABLE_ROW_CAP);
    const result = capTableRows(exact);
    expect(result.rows).toHaveLength(TABLE_ROW_CAP);
    expect(result.capNote).toBeNull();
  });

  it('caps rows above the limit and reports the counts', () => {
    const { rows, capNote } = capTableRows(makeRows(30000));
    expect(rows).toHaveLength(TABLE_ROW_CAP);
    expect(rows[0].__id).toBe(0);
    expect(rows[TABLE_ROW_CAP - 1].__id).toBe(TABLE_ROW_CAP - 1);
    expect(capNote).toBe('Showing first 1,000 of 30,000 rows');
  });

  it('caps at exactly one row over the limit', () => {
    const { rows, capNote } = capTableRows(makeRows(TABLE_ROW_CAP + 1));
    expect(rows).toHaveLength(TABLE_ROW_CAP);
    expect(capNote).toBe('Showing first 1,000 of 1,001 rows');
  });

  it('handles empty datasets', () => {
    expect(capTableRows([])).toEqual({ rows: [], capNote: null });
  });

  it('respects a custom cap', () => {
    const { rows, capNote } = capTableRows(makeRows(5), 3);
    expect(rows).toHaveLength(3);
    expect(capNote).toBe('Showing first 3 of 5 rows');
  });
});
