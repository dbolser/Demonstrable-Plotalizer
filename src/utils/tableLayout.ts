// Pure logic for the resizable data-table panel (issues #49 and #56).
// Kept free of DOM/React so it can be unit-tested directly.

/** Minimum height of the table panel in px. */
export const TABLE_MIN_HEIGHT = 80;

/** The table panel may take up at most this fraction of the main area. */
export const TABLE_MAX_CONTAINER_FRACTION = 0.7;

/** Max rows shown when displaying the full (unselected) dataset. */
export const TABLE_ROW_CAP = 1000;

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

export interface CappedRows<T> {
  rows: T[];
  /** Human-readable note when rows were capped, otherwise null. */
  capNote: string | null;
}

/**
 * Cap a full-dataset view at `cap` rows with a "Showing first X of N rows"
 * note. Selection views are never capped (a brush selection is already
 * bounded by what the user swept).
 */
export function capTableRows<T>(rows: T[], cap: number = TABLE_ROW_CAP): CappedRows<T> {
  if (rows.length <= cap) {
    return { rows, capNote: null };
  }
  return {
    rows: rows.slice(0, cap),
    capNote: `Showing first ${cap.toLocaleString('en-US')} of ${rows.length.toLocaleString('en-US')} rows`,
  };
}
