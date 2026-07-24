import type { ColorMode } from '../../types';

/**
 * Demo defaults for the bundled sample dataset (iris).
 *
 * The sample data is most people's first impression of the app, so instead of
 * the neutral monochrome defaults it ships with the colorful features turned
 * on: category coloring by species, |r|-tinted cell borders, and per-cell
 * regression lines. These are ordinary initial values — the user can toggle
 * each one off afterwards exactly like normal.
 *
 * The decision of WHETHER (and with what values) to apply those defaults is
 * kept here as a pure function so it can be tested exhaustively
 * (PLAN.md regression guarantee (a)).
 */

/** The sample dataset's category column used for color-by. */
export const SAMPLE_CATEGORY_COLUMN = 'species';

export interface SampleDefaultsContext {
  /** True only when the load came from the bundled sample dataset
   * (auto-load on first visit or the "Load Sample Data" button). */
  isSample: boolean;
  /** True when a shared #view= state is pending and about to be applied —
   * the share link's settings must win over the demo defaults. */
  hasPendingViewState: boolean;
  /** String (categorical) columns detected in the loaded data. */
  stringColumns: readonly string[];
}

export interface SampleDefaults {
  colorMode: ColorMode;
  categoryColorColumn: string | null;
  tintCellBorders: boolean;
  showRegressionLine: boolean;
}

/**
 * Decide the initial demo defaults for a completed data load.
 *
 * Returns the defaults to apply, or null when the load must keep the current
 * neutral behavior (non-sample data, or a pending shared view that overrides
 * everything). If the sample somehow lacks its category column, the
 * non-categorical extras (border tint, regression lines) still apply but
 * color mode is left at 'none'.
 *
 * Note: tinting cell borders does not require the correlation badges —
 * ScatterPlotMatrix computes correlations whenever either flag is on
 * (`correlationActive = showCorrelation || tintCellBorders`).
 */
export function computeSampleDefaults(context: SampleDefaultsContext): SampleDefaults | null {
  if (!context.isSample) return null;
  if (context.hasPendingViewState) return null;

  const hasCategoryColumn = context.stringColumns.includes(SAMPLE_CATEGORY_COLUMN);
  return {
    colorMode: hasCategoryColumn ? 'category' : 'none',
    categoryColorColumn: hasCategoryColumn ? SAMPLE_CATEGORY_COLUMN : null,
    tintCellBorders: true,
    showRegressionLine: true,
  };
}
