import { describe, it, expect } from 'vitest';
import { shouldPaintAnotherCell, FRAME_BUDGET_MS } from '../utils/renderSchedule';

describe('shouldPaintAnotherCell', () => {
  describe('progress guarantee', () => {
    it('always allows the first cell of a frame, even with the budget already exhausted', () => {
      expect(shouldPaintAnotherCell(0, FRAME_BUDGET_MS * 10, 0)).toBe(true);
    });

    it('allows the first cell even when the clock is broken (NaN / backwards)', () => {
      expect(shouldPaintAnotherCell(NaN, NaN, 0)).toBe(true);
      expect(shouldPaintAnotherCell(100, 50, 0)).toBe(true);
    });
  });

  describe('budget-driven pacing', () => {
    it('keeps painting while under budget — no fixed cell cap', () => {
      // Simulate 50 cheap cells at 0.2ms each: all fit in one 12ms frame.
      const frameStart = 1000;
      for (let painted = 0; painted < 50; painted++) {
        const now = frameStart + painted * 0.2;
        expect(shouldPaintAnotherCell(frameStart, now, painted)).toBe(true);
      }
    });

    it('stops once the elapsed time reaches the budget', () => {
      expect(shouldPaintAnotherCell(0, FRAME_BUDGET_MS, 3)).toBe(false);
      expect(shouldPaintAnotherCell(0, FRAME_BUDGET_MS + 1, 1)).toBe(false);
    });

    it('allows another cell just under the budget boundary', () => {
      expect(shouldPaintAnotherCell(0, FRAME_BUDGET_MS - 0.01, 100)).toBe(true);
    });

    it('respects a custom budget', () => {
      expect(shouldPaintAnotherCell(0, 4, 1, 5)).toBe(true);
      expect(shouldPaintAnotherCell(0, 5, 1, 5)).toBe(false);
    });

    it('paces expensive cells to roughly one per frame when each blows the budget', () => {
      // A point-heavy cell that takes 20ms: after painting it, the frame stops.
      const frameStart = 500;
      expect(shouldPaintAnotherCell(frameStart, frameStart, 0)).toBe(true);
      expect(shouldPaintAnotherCell(frameStart, frameStart + 20, 1)).toBe(false);
    });
  });

  describe('clock-skew safety', () => {
    it('stops the frame (after the first cell) when the clock goes backwards', () => {
      expect(shouldPaintAnotherCell(100, 50, 1)).toBe(false);
    });

    it('stops the frame (after the first cell) on a non-finite clock reading', () => {
      expect(shouldPaintAnotherCell(0, NaN, 1)).toBe(false);
      expect(shouldPaintAnotherCell(0, Infinity, 1)).toBe(false);
      expect(shouldPaintAnotherCell(NaN, 0, 1)).toBe(false);
    });

    it('a frozen clock (zero elapsed) keeps painting — the caller is bounded by its task queue', () => {
      expect(shouldPaintAnotherCell(1000, 1000, 500)).toBe(true);
    });
  });
});
