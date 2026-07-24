// Pure logic for the resizable data-table panel (issues #49 and #56).
// Kept free of DOM/React so it can be unit-tested directly.

/** Minimum height of the table panel in px. */
export const TABLE_MIN_HEIGHT = 80;

/** The table panel may take up at most this fraction of the main area. */
export const TABLE_MAX_CONTAINER_FRACTION = 0.7;

/**
 * Fixed height of one data-table row in px. Rows are py-2 (8px top/bottom)
 * around a text-sm line (20px) = 36px content, plus the 1px collapsed
 * divide-y border. Cells use whitespace-nowrap so content can never wrap
 * and change this. The windowing math (computeRowWindow) depends on it.
 */
export const TABLE_ROW_HEIGHT = 37;

/** Extra rows rendered above/below the visible window to hide scroll gaps. */
export const TABLE_OVERSCAN = 5;

/**
 * Clamp a desired table height to [TABLE_MIN_HEIGHT, 70% of the container].
 * If the container is tiny, the minimum wins (the panel never collapses
 * below TABLE_MIN_HEIGHT, even if that overflows a degenerate container).
 */
export function clampTableHeight(desired: number, containerHeight: number): number {
  const max = Math.max(
    TABLE_MIN_HEIGHT,
    Math.floor(containerHeight * TABLE_MAX_CONTAINER_FRACTION)
  );
  return Math.min(max, Math.max(TABLE_MIN_HEIGHT, Math.round(desired)));
}

/**
 * Height during a divider drag, computed from the drag-start anchor and the
 * absolute pointer position (never from incremental deltas, which drift).
 * Dragging the divider up (smaller clientY) grows the table.
 */
export function computeDragHeight(
  startHeight: number,
  startY: number,
  currentY: number
): number {
  return startHeight + (startY - currentY);
}

/**
 * Visibility matrix for the table panel (issue #56):
 *
 * | toggle | selection | table  |
 * |--------|-----------|--------|
 * | off    | none      | hidden |
 * | off    | active    | shown  | (selection auto-shows the table — preserved behavior)
 * | on     | none      | shown  | (full dataset, capped)
 * | on     | active    | shown  | (selected rows)
 */
export function isTableVisible(showTable: boolean, hasSelection: boolean): boolean {
  return showTable || hasSelection;
}

export interface RowWindow {
  /** First rendered row index (inclusive). */
  start: number;
  /** One past the last rendered row index (exclusive). */
  end: number;
  /** Spacer height above the rendered rows, in px. */
  padTop: number;
  /** Spacer height below the rendered rows, in px. */
  padBottom: number;
}

/**
 * Windowed-rendering math for the data table: given the scroll position and
 * viewport of the scroll container, return which fixed-height rows to render
 * plus the spacer heights that stand in for the off-screen rows. Keeps the
 * DOM row count ~constant regardless of dataset size (30k+ rows scroll with
 * only a few dozen <tr> elements mounted).
 *
 * Pure and clamped: any scrollTop/viewportHeight (including stale values
 * after the dataset shrinks, or negative overscroll) yields a valid window.
 */
export function computeRowWindow(
  scrollTop: number,
  viewportHeight: number,
  totalRows: number,
  rowHeight: number = TABLE_ROW_HEIGHT,
  overscan: number = TABLE_OVERSCAN
): RowWindow {
  if (totalRows <= 0 || rowHeight <= 0) {
    return { start: 0, end: 0, padTop: 0, padBottom: 0 };
  }
  // First row any part of which is at/below the top edge of the viewport,
  // clamped so stale scroll positions (dataset shrank) stay in range.
  const first = Math.min(
    Math.max(0, Math.floor(scrollTop / rowHeight)),
    totalRows - 1
  );
  // +1 covers the partially-visible row at the bottom edge.
  const visibleCount = Math.ceil(Math.max(0, viewportHeight) / rowHeight) + 1;
  const start = Math.max(0, first - overscan);
  const end = Math.min(totalRows, first + visibleCount + overscan);
  return {
    start,
    end,
    padTop: start * rowHeight,
    padBottom: (totalRows - end) * rowHeight,
  };
}
