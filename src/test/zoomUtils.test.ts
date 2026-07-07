import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  MIN_CELL_SIZE,
  MAX_CELL_SIZE,
  ZOOM_COMMIT_DEBOUNCE_MS,
  ZOOM_STEP_FACTOR,
  clampCellSize,
  normalizeWheelDelta,
  wheelDeltaToScaleFactor,
  clampScaleForCellSize,
  accumulateWheelZoom,
  commitZoom,
  stepCellSize,
  isZoomWheelEvent,
  createZoomGestureController,
} from '../utils/zoomUtils';

describe('zoomUtils: pure math', () => {
  describe('clampCellSize', () => {
    it('rounds to whole pixels', () => {
      expect(clampCellSize(150.4)).toBe(150);
      expect(clampCellSize(150.6)).toBe(151);
    });

    it('clamps to the allowed range', () => {
      expect(clampCellSize(1)).toBe(MIN_CELL_SIZE);
      expect(clampCellSize(10_000)).toBe(MAX_CELL_SIZE);
      expect(clampCellSize(MIN_CELL_SIZE)).toBe(MIN_CELL_SIZE);
      expect(clampCellSize(MAX_CELL_SIZE)).toBe(MAX_CELL_SIZE);
    });
  });

  describe('normalizeWheelDelta', () => {
    it('passes pixel-mode deltas (deltaMode 0) through unchanged', () => {
      expect(normalizeWheelDelta(-100, 0)).toBe(-100);
      expect(normalizeWheelDelta(42, 0)).toBe(42);
    });

    it('converts line-mode deltas (deltaMode 1, e.g. Firefox mouse wheel) to pixels', () => {
      expect(normalizeWheelDelta(-3, 1)).toBe(-48);
      expect(normalizeWheelDelta(3, 1)).toBe(48);
    });

    it('converts page-mode deltas (deltaMode 2) to pixels', () => {
      expect(normalizeWheelDelta(-1, 2)).toBe(-800);
      expect(normalizeWheelDelta(1, 2)).toBe(800);
    });
  });

  describe('wheelDeltaToScaleFactor', () => {
    it('zooms in on scroll up (negative deltaY)', () => {
      expect(wheelDeltaToScaleFactor(-100)).toBeGreaterThan(1);
    });

    it('zooms out on scroll down (positive deltaY)', () => {
      expect(wheelDeltaToScaleFactor(100)).toBeLessThan(1);
      expect(wheelDeltaToScaleFactor(100)).toBeGreaterThan(0);
    });

    it('is identity for deltaY 0 and symmetric for +/- deltas', () => {
      expect(wheelDeltaToScaleFactor(0)).toBe(1);
      expect(wheelDeltaToScaleFactor(-100) * wheelDeltaToScaleFactor(100)).toBeCloseTo(1, 12);
    });
  });

  describe('accumulateWheelZoom / clampScaleForCellSize', () => {
    it('accumulates multiplicatively across ticks', () => {
      const oneTick = accumulateWheelZoom(1, -100, 150);
      const twoTicks = accumulateWheelZoom(oneTick, -100, 150);
      expect(twoTicks).toBeCloseTo(oneTick * oneTick, 12);
    });

    it('never lets cellSize * scale exceed MAX_CELL_SIZE', () => {
      let scale = 1;
      for (let i = 0; i < 100; i++) scale = accumulateWheelZoom(scale, -500, 150);
      expect(150 * scale).toBeLessThanOrEqual(MAX_CELL_SIZE + 1e-9);
    });

    it('never lets cellSize * scale fall below MIN_CELL_SIZE', () => {
      let scale = 1;
      for (let i = 0; i < 100; i++) scale = accumulateWheelZoom(scale, 500, 150);
      expect(150 * scale).toBeGreaterThanOrEqual(MIN_CELL_SIZE - 1e-9);
    });

    it('falls back to a neutral scale for degenerate inputs', () => {
      expect(clampScaleForCellSize(Number.NaN, 150)).toBe(1);
      expect(clampScaleForCellSize(2, 0)).toBe(1);
    });
  });

  describe('commitZoom', () => {
    it('commits round(cellSize * scale)', () => {
      expect(commitZoom(150, 1.221)).toBe(183);
      expect(commitZoom(150, 1)).toBe(150);
    });

    it('clamps the committed size', () => {
      expect(commitZoom(150, 100)).toBe(MAX_CELL_SIZE);
      expect(commitZoom(150, 0.01)).toBe(MIN_CELL_SIZE);
    });
  });

  describe('stepCellSize', () => {
    it('steps ~20% up and down', () => {
      expect(stepCellSize(150, 1)).toBe(Math.round(150 * ZOOM_STEP_FACTOR));
      expect(stepCellSize(150, -1)).toBe(Math.round(150 / ZOOM_STEP_FACTOR));
    });

    it('clamps at the bounds', () => {
      expect(stepCellSize(MAX_CELL_SIZE, 1)).toBe(MAX_CELL_SIZE);
      expect(stepCellSize(MIN_CELL_SIZE, -1)).toBe(MIN_CELL_SIZE);
    });
  });

  describe('isZoomWheelEvent (wheel-handler gating)', () => {
    it('accepts Ctrl+wheel and Cmd+wheel', () => {
      expect(isZoomWheelEvent({ ctrlKey: true, metaKey: false })).toBe(true);
      expect(isZoomWheelEvent({ ctrlKey: false, metaKey: true })).toBe(true);
    });

    it('rejects plain wheel (normal scrolling)', () => {
      expect(isZoomWheelEvent({ ctrlKey: false, metaKey: false })).toBe(false);
    });
  });
});

describe('zoomUtils: createZoomGestureController (debounced commit)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const makeController = (cellSize = 150) => {
    const onScaleChange = vi.fn();
    const onCommit = vi.fn();
    const controller = createZoomGestureController({
      getCellSize: () => cellSize,
      onScaleChange,
      onCommit,
    });
    return { controller, onScaleChange, onCommit };
  };

  it('reports scale changes immediately but does not commit before the debounce', () => {
    const { controller, onScaleChange, onCommit } = makeController();

    controller.wheel(-100);
    expect(onScaleChange).toHaveBeenCalledTimes(1);
    expect(onScaleChange).toHaveBeenLastCalledWith(wheelDeltaToScaleFactor(-100));
    expect(controller.isActive()).toBe(true);

    vi.advanceTimersByTime(ZOOM_COMMIT_DEBOUNCE_MS - 1);
    expect(onCommit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('resets the debounce window on every wheel tick', () => {
    const { controller, onCommit } = makeController();

    controller.wheel(-100);
    vi.advanceTimersByTime(ZOOM_COMMIT_DEBOUNCE_MS - 50);
    controller.wheel(-100);
    vi.advanceTimersByTime(ZOOM_COMMIT_DEBOUNCE_MS - 50);
    expect(onCommit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('commits the accumulated (clamped, rounded) cellSize and resets to idle', () => {
    const { controller, onCommit } = makeController(150);

    controller.wheel(-100);
    controller.wheel(-100);
    const expectedScale = accumulateWheelZoom(
      accumulateWheelZoom(1, -100, 150),
      -100,
      150
    );

    vi.advanceTimersByTime(ZOOM_COMMIT_DEBOUNCE_MS);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(commitZoom(150, expectedScale));
    expect(controller.isActive()).toBe(false);
    expect(controller.getScale()).toBe(1);

    // No stray second commit later.
    vi.advanceTimersByTime(ZOOM_COMMIT_DEBOUNCE_MS * 5);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('a follow-up gesture starts fresh from scale 1', () => {
    const { controller, onCommit } = makeController(150);

    controller.wheel(-100);
    vi.advanceTimersByTime(ZOOM_COMMIT_DEBOUNCE_MS);

    controller.wheel(-100);
    vi.advanceTimersByTime(ZOOM_COMMIT_DEBOUNCE_MS);

    expect(onCommit).toHaveBeenCalledTimes(2);
    // Both gestures had a single identical tick, so identical commit values.
    expect(onCommit.mock.calls[0][0]).toBe(onCommit.mock.calls[1][0]);
  });

  it('cancel() aborts the pending commit', () => {
    const { controller, onCommit } = makeController();

    controller.wheel(-100);
    controller.cancel();
    expect(controller.isActive()).toBe(false);
    expect(controller.getScale()).toBe(1);

    vi.advanceTimersByTime(ZOOM_COMMIT_DEBOUNCE_MS * 2);
    expect(onCommit).not.toHaveBeenCalled();
  });
});
