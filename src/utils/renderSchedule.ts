/**
 * Pacing for the RAF-budgeted canvas paint loop (ScatterPlotMatrix).
 *
 * Historically the loop was capped at a fixed 4 cells per frame, which
 * floored large-matrix paints once the WebGL point-sprite renderer made
 * per-cell cost tiny: a 56-cell matrix took ~14 frames (~230ms) even though
 * the actual work fit comfortably in one frame. Pacing is now time-budget
 * driven: keep painting until the frame's paint budget is spent. Cheap cells
 * pack many per frame; expensive cells still stop the frame early so the
 * main thread stays responsive.
 */

/**
 * Per-frame paint budget in milliseconds. ~12ms leaves headroom inside a
 * 60Hz frame (16.7ms) for the browser's own layout/composite work.
 */
export const FRAME_BUDGET_MS = 12;

/**
 * Decide whether the paint loop should render one more cell in the current
 * animation frame.
 *
 * Rules, in order:
 * 1. Progress guarantee — the first cell of a frame is always painted, even
 *    if the clock claims the budget is already gone. Every frame therefore
 *    makes forward progress and the render terminates.
 * 2. Clock-skew safety — a negative or non-finite elapsed time means the
 *    clock is unreliable (system clock adjustment, mocked timer); stop the
 *    frame rather than risk an unbounded stall. Progress continues at one
 *    cell per frame via rule 1.
 * 3. Budget — otherwise paint another cell only while the time already spent
 *    this frame is strictly under the budget.
 *
 * A frozen-but-valid clock (elapsed stays 0) keeps returning true; the
 * caller's loop is still bounded by its task queue length.
 *
 * @param frameStart timestamp captured at the start of the frame's paint loop
 * @param now current timestamp (same clock as frameStart, e.g. performance.now())
 * @param paintedThisFrame cells already painted in this frame
 * @param budgetMs per-frame paint budget; defaults to FRAME_BUDGET_MS
 */
export function shouldPaintAnotherCell(
  frameStart: number,
  now: number,
  paintedThisFrame: number,
  budgetMs: number = FRAME_BUDGET_MS
): boolean {
  if (paintedThisFrame < 1) return true;
  const elapsed = now - frameStart;
  if (!Number.isFinite(elapsed) || elapsed < 0) return false;
  return elapsed < budgetMs;
}
