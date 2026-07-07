// Fluid tile-zoom logic (issue #57).
//
// During a Ctrl/Cmd+wheel gesture the matrix is scaled with a cheap CSS
// transform (no canvas repaints); when the gesture ends (debounced), the
// accumulated scale is committed as a new cellSize and the normal render
// pipeline repaints once at the new size. The pure math lives here so it can
// be unit-tested without a DOM.

/** Committed cellSize bounds. Kept in sync with the ControlPanel slider. */
export const MIN_CELL_SIZE = 60;
export const MAX_CELL_SIZE = 400;

/** Quiet period after the last wheel event before the zoom is committed. */
export const ZOOM_COMMIT_DEBOUNCE_MS = 200;

/** Step factor for the +/- zoom buttons (~20% per step). */
export const ZOOM_STEP_FACTOR = 1.2;

/** Wheel sensitivity: scale factor = exp(-deltaY * sensitivity). */
const WHEEL_ZOOM_SENSITIVITY = 0.002;

/** Clamp (and round) a cell size to the allowed range. */
export const clampCellSize = (size: number): number =>
  Math.min(MAX_CELL_SIZE, Math.max(MIN_CELL_SIZE, Math.round(size)));

/**
 * Convert a wheel deltaY into a multiplicative zoom factor.
 * Scrolling up (negative deltaY) zooms in (> 1), down zooms out (< 1).
 * The exponential form makes equal wheel increments compose symmetrically:
 * +100 then -100 returns exactly to a factor of 1.
 */
export const wheelDeltaToScaleFactor = (deltaY: number): number =>
  Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY);

/**
 * Clamp a transient gesture scale so that `cellSize * scale` stays within
 * [MIN_CELL_SIZE, MAX_CELL_SIZE]. Keeps the CSS preview honest about what
 * the commit will produce.
 */
export const clampScaleForCellSize = (scale: number, cellSize: number): number => {
  if (!isFinite(scale) || cellSize <= 0) return 1;
  return Math.min(MAX_CELL_SIZE / cellSize, Math.max(MIN_CELL_SIZE / cellSize, scale));
};

/** Accumulate one wheel tick into the running gesture scale (clamped). */
export const accumulateWheelZoom = (
  currentScale: number,
  deltaY: number,
  cellSize: number
): number => clampScaleForCellSize(currentScale * wheelDeltaToScaleFactor(deltaY), cellSize);

/** Resolve the gesture: the cellSize to commit for an accumulated scale. */
export const commitZoom = (cellSize: number, scale: number): number =>
  clampCellSize(cellSize * scale);

/** One +/- button (or keyboard) step: ~20% in the given direction, clamped. */
export const stepCellSize = (cellSize: number, direction: 1 | -1): number =>
  clampCellSize(cellSize * (direction > 0 ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR));

/** A wheel event is a zoom gesture only with Ctrl (or Cmd on macOS) held. */
export const isZoomWheelEvent = (event: { ctrlKey: boolean; metaKey: boolean }): boolean =>
  event.ctrlKey || event.metaKey;

export interface ZoomGestureCallbacks {
  /** Current committed cell size (read at wheel/commit time, not captured). */
  getCellSize: () => number;
  /** Fired on every wheel tick with the new accumulated scale (for the CSS preview). */
  onScaleChange: (scale: number) => void;
  /** Fired once, ZOOM_COMMIT_DEBOUNCE_MS after the last wheel tick. */
  onCommit: (nextCellSize: number) => void;
}

export interface ZoomGestureController {
  /** Feed one wheel tick (deltaY) into the gesture. */
  wheel: (deltaY: number) => void;
  /** True while a gesture is in flight (commit still pending). */
  isActive: () => boolean;
  /** Current accumulated scale (1 when idle). */
  getScale: () => number;
  /** Abort the gesture without committing (e.g. on unmount). */
  cancel: () => void;
}

/**
 * Debounced wheel-zoom gesture: accumulates scale across wheel ticks and
 * commits a single cellSize change after a quiet period.
 */
export const createZoomGestureController = (
  callbacks: ZoomGestureCallbacks,
  debounceMs: number = ZOOM_COMMIT_DEBOUNCE_MS
): ZoomGestureController => {
  let scale = 1;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const commit = () => {
    timer = null;
    const nextCellSize = commitZoom(callbacks.getCellSize(), scale);
    scale = 1;
    callbacks.onCommit(nextCellSize);
  };

  return {
    wheel(deltaY: number) {
      scale = accumulateWheelZoom(scale, deltaY, callbacks.getCellSize());
      callbacks.onScaleChange(scale);
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(commit, debounceMs);
    },
    isActive: () => timer !== null,
    getScale: () => scale,
    cancel() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      scale = 1;
    },
  };
};
