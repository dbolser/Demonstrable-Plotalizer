import React, { useRef, useEffect, useMemo, useCallback, useState } from 'react';
import * as d3 from 'd3';
import { useDrag, useDrop } from 'react-dnd';
import type { DataPoint, Column, BrushSelection, FilterMode } from '../types';
import { mapVisibleColumns } from '../src/utils/columnUtils';
import { filterData } from '../src/utils/dataUtils';
import { computeSelectedStateHash, createSpatialGrid, getPointsInBrush } from '../src/utils/selectionUtils';
import { ImageDataLRU, totalSnapshotBytes } from '../src/utils/imageDataCache';
import { cellValueToNumber } from '../src/utils/cellValueUtils';
import { MISSING_COLOR, MISSING_SLOT } from '../src/utils/colorUtils';
import type { ColorState } from '../src/utils/colorUtils';
import { buildRenderKey } from '../src/utils/renderKeyUtils';
import {
  getStackConfig,
  computeStackedBinCounts,
  buildStackSegments,
  isFiniteCellValue,
} from '../src/utils/histogramStackUtils';
import { computeIdentityOverlap, fitRegression } from '../src/utils/referenceLineUtils';
import type { RegressionFit } from '../src/utils/referenceLineUtils';
import {
  pearsonFromFit,
  spearmanCorrelation,
  correlationBorderAlpha,
} from '../src/utils/correlationUtils';
import type { CorrelationKind, CorrelationResult } from '../src/utils/correlationUtils';
import { createZoomGestureController, isZoomWheelEvent, normalizeWheelDelta } from '../src/utils/zoomUtils';

interface ScatterPlotMatrixProps {
  data: DataPoint[];
  columns: Column[];
  onColumnReorder: (dragIndex: number, hoverIndex: number) => void;
  brushSelection: BrushSelection;
  onBrush: (selection: BrushSelection) => void;
  filterMode: FilterMode;
  showHistograms: boolean;
  useUniformLogBins: boolean;
  labelColumn: string | null;
  onPointHover: (content: string, event: MouseEvent) => void;
  onPointLeave: () => void;
  cellSize?: number;
  /** Commit callback for the fluid Ctrl/Cmd+wheel zoom gesture (issue #57). */
  onCellSizeChange?: (size: number) => void;
  onRenderComplete?: () => void;
  onRenderProgress?: (cellsDone: number, cellsTotal: number) => void;
  /** Precomputed per-row color state, or null for the classic flat colors. */
  colorState?: ColorState | null;
  /** Column currently driving the rainbow gradient order (highlighted label). */
  rainbowOrderColumn?: string | null;
  /**
   * Fired when a diagonal column label is clicked (not dragged). Used in
   * rainbow mode to re-order the gradient by that column's rank.
   */
  onColumnLabelClick?: (columnName: string) => void;
  /** Draw a dashed y=x identity line in each cell where the domains overlap. */
  showIdentityLine?: boolean;
  /** Draw a per-cell least-squares regression line (fit in transformed space). */
  showRegressionLine?: boolean;
  /** Draw a compact per-cell correlation badge, e.g. "r=-0.82" (issue #36). */
  showCorrelation?: boolean;
  /** Metric behind the badge and border tint: Pearson r or Spearman ρ. */
  correlationMetric?: CorrelationKind;
  /** Tint each cell's border by |r| — transparent → strong for 0 → 1. */
  tintCellBorders?: boolean;
}

// RAF-budgeted canvas rendering: paint at most this many cells per frame…
const CELLS_PER_FRAME = 4;
// …or stop early once this much of the frame has been spent painting.
const FRAME_BUDGET_MS = 12;

// ImageData snapshot cache: restore previously-seen (unselected) cell
// configurations via putImageData instead of re-plotting every point.
const SNAPSHOT_CAPACITY_PER_CELL = 6;
// Skip caching for very large cells — one 300px RGBA snapshot is ~360KB.
const SNAPSHOT_MAX_CELL_SIZE = 300;
// Overall byte budget across all cells; beyond this, new snapshots are skipped.
const SNAPSHOT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;

// Reference-line styling (issue #50). Identity: dashed neutral gray;
// regression: solid dark red at moderate alpha. Both 1px so they read as
// annotations, not data.
const IDENTITY_LINE_COLOR = '#9ca3af';
const REGRESSION_LINE_COLOR = '#b91c1c';
const REGRESSION_LINE_ALPHA = 0.7;
// Only draw the small badge (r / r²) when the cell is big enough for it not
// to collide with the point cloud/axis ticks.
const BADGE_MIN_CELL_SIZE = 100;
// Correlation badge color when the regression overlay is off (with the
// regression line on, the combined badge inherits its dark red).
const CORRELATION_BADGE_COLOR = '#374151';
// Border tint (issue #36): amber, deliberately distinct from the selection
// blue (#1e40af), the dimmed gray, and the regression dark red, so the tint
// never fights the selection/brush visuals. Opacity encodes |r|.
const CORRELATION_BORDER_COLOR = '#d97706';
// Safety cap on the per-cell pairwise-stats memo (keys include data hash and
// filter state, so entries go stale; a simple clear keeps memory bounded).
const PAIR_STATS_CACHE_MAX_ENTRIES = 512;

// One memo entry per column pair/config: the regression fit (issue #50) and
// the Spearman correlation (issue #36) share the cache — Pearson r is
// derived from the fit itself (r = sign(slope)·√r²). Fields are computed
// lazily, `undefined` = not computed yet, `null` = computed but degenerate.
interface PairStats {
  fit?: RegressionFit | null;
  spearman?: CorrelationResult | null;
}

interface CoordinateDisplay {
  visible: boolean;
  x: number;
  y: number;
  xValue: number | null;
  yValue: number | null;
  xColumn: string | null;
  yColumn: string | null;
}

interface HistogramBin {
  x0: number;
  x1: number;
  totalLength: number;
  selectedLength: number;
}

// Draw a batch of points that share one fill color as a single path:
// coords is a flat [x0, y0, x1, y1, ...] array.
const drawPointBatch = (
  ctx: CanvasRenderingContext2D,
  coords: number[],
  color: string,
  alpha: number
) => {
  if (coords.length === 0) return;
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  for (let k = 0; k < coords.length; k += 2) {
    const sx = coords[k];
    const sy = coords[k + 1];
    ctx.moveTo(sx + 2.5, sy);
    ctx.arc(sx, sy, 2.5, 0, 2 * Math.PI);
  }
  ctx.fill();
};

const DraggableHeader: React.FC<{
  name: string,
  index: number,
  onColumnReorder: (dragIndex: number, hoverIndex: number) => void,
  onDragStart?: () => void,
  onDragEnd?: () => void,
  onLabelClick?: (name: string) => void,
  labelClickHint?: string | null,
  isRainbowOrderColumn?: boolean
}> = ({ name, index, onColumnReorder, onDragStart, onDragEnd, onLabelClick, labelClickHint, isRainbowOrderColumn }) => {
  const ref = useRef<HTMLDivElement>(null);
  // A drag also fires a click on drop; suppress that click so dragging a
  // column to reorder never doubles as a rainbow-order toggle.
  const dragHappenedRef = useRef(false);

  const [{ isOver }, drop] = useDrop({
    accept: 'column',
    drop(item: { index: number, originalIndex: number }) {
      const dragIndex = item.originalIndex;
      const hoverIndex = index;
      if (dragIndex !== hoverIndex) {
        onColumnReorder(dragIndex, hoverIndex);
      }
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
    }),
  });

  const [{ isDragging }, drag] = useDrag({
    type: 'column',
    item: () => {
      dragHappenedRef.current = true;
      onDragStart?.();
      return { index, originalIndex: index };
    },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
    end: () => {
      onDragEnd?.();
    },
  });

  drag(drop(ref));

  const handleClick = () => {
    if (dragHappenedRef.current) {
      dragHappenedRef.current = false;
      return;
    }
    onLabelClick?.(name);
  };

  return (
    <div
      ref={ref}
      style={{ opacity: isDragging ? 0.5 : 1 }}
      onMouseDown={() => { dragHappenedRef.current = false; }}
      onClick={onLabelClick ? handleClick : undefined}
      title={labelClickHint ?? undefined}
      data-rainbow-order={isRainbowOrderColumn ? 'true' : undefined}
      className={`w-full h-full flex items-center justify-center border rounded cursor-move select-none ${isDragging ? 'border-brand-secondary bg-gray-100' :
        isOver ? 'border-brand-primary bg-brand-primary/10' :
          isRainbowOrderColumn ? 'border-purple-500 ring-2 ring-purple-500 bg-purple-50' :
            'border-gray-300'
        }`}
    >
      {isDragging ? (
        <span className="font-bold text-gray-400 p-2 text-center break-all">Moving...</span>
      ) : isOver ? (
        <span className="font-bold text-brand-primary p-2 text-center break-all">Drop here</span>
      ) : (
        <span className="font-bold text-brand-dark p-2 text-center break-all">
          {name}
          {isRainbowOrderColumn && (
            <span className="block text-[10px] font-semibold text-purple-600 uppercase tracking-wide">
              gradient order
            </span>
          )}
        </span>
      )}
    </div>
  );
};


export const ScatterPlotMatrix: React.FC<ScatterPlotMatrixProps> = ({
  data,
  columns,
  onColumnReorder,
  brushSelection,
  onBrush,
  filterMode,
  showHistograms,
  useUniformLogBins,
  labelColumn,
  onPointHover,
  onPointLeave,
  cellSize = 150,
  onCellSizeChange,
  onRenderComplete,
  onRenderProgress,
  colorState = null,
  rainbowOrderColumn = null,
  onColumnLabelClick,
  showIdentityLine = false,
  showRegressionLine = false,
  showCorrelation = false,
  correlationMetric = 'pearson',
  tintCellBorders = false,
}) => {
  const ref = useRef<SVGSVGElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const canvasElementsRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const canvasRenderKeyRef = useRef<Map<string, string>>(new Map());
  // Per-canvas LRU of unselected-state ImageData snapshots, keyed by renderKey
  const snapshotCachesRef = useRef<Map<string, ImageDataLRU>>(new Map());
  const snapshotDataHashRef = useRef<string>('');
  const isDraggingRef = useRef(false);
  const [coordinateDisplay, setCoordinateDisplay] = useState<CoordinateDisplay>({
    visible: false,
    x: 0,
    y: 0,
    xValue: null,
    yValue: null,
    xColumn: null,
    yColumn: null
  });
  const size = cellSize;
  const padding = 20;

  // --- Fluid zoom gesture (issue #57) -------------------------------------
  // While Ctrl/Cmd+wheel is in flight, the already-painted matrix is scaled
  // with a CSS transform only (blurry but cheap — no canvas repaints). The
  // debounced commit then updates cellSize through the normal pipeline for a
  // single crisp re-render. `zoomGesture` is deliberately NOT a dependency of
  // the paint effect below, so per-tick updates never retrigger painting.
  const [zoomGesture, setZoomGesture] = useState<{ scale: number; origin: string } | null>(null);
  const cellSizeRef = useRef(cellSize);
  const onCellSizeChangeRef = useRef(onCellSizeChange);
  useEffect(() => {
    cellSizeRef.current = cellSize;
    onCellSizeChangeRef.current = onCellSizeChange;
  }, [cellSize, onCellSizeChange]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    // transform-origin is captured at gesture start (near the cursor) and
    // held for the rest of the gesture so the preview doesn't jump around.
    let gestureOrigin = '0px 0px';

    const controller = createZoomGestureController({
      getCellSize: () => cellSizeRef.current,
      onScaleChange: scale => setZoomGesture({ scale, origin: gestureOrigin }),
      onCommit: nextCellSize => {
        setZoomGesture(null);
        if (nextCellSize !== cellSizeRef.current) {
          onCellSizeChangeRef.current?.(nextCellSize);
        }
      },
    });

    const handleWheel = (event: WheelEvent) => {
      // Zoom is disabled without a commit callback — leave the browser's
      // default Ctrl/Cmd+wheel behavior (page zoom) alone in that case.
      if (!onCellSizeChangeRef.current) return;
      // Plain wheel keeps normal scrolling; only Ctrl/Cmd+wheel zooms.
      if (!isZoomWheelEvent(event)) return;
      event.preventDefault(); // stop browser page-zoom
      if (!controller.isActive()) {
        // Scale is still 1 here, so the rect is untransformed.
        const rect = el.getBoundingClientRect();
        gestureOrigin = `${event.clientX - rect.left}px ${event.clientY - rect.top}px`;
      }
      // deltaY may be in lines/pages depending on the device (deltaMode).
      controller.wheel(normalizeWheelDelta(event.deltaY, event.deltaMode));
    };

    // Native listener: React attaches wheel handlers passively, which would
    // make preventDefault() a no-op.
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheel);
      controller.cancel();
    };
  }, []);
  // -------------------------------------------------------------------------

  // Tooltip positioning constants
  const TOOLTIP_WIDTH = 200;
  const TOOLTIP_HEIGHT = 40;
  const TOOLTIP_OFFSET = 10;

  const { visibleColumns, visibleIndexToOriginalIndex } = useMemo(
    () => mapVisibleColumns(columns),
    [columns]
  );

  const n = visibleColumns.length;
  const plotSize = showHistograms ? size * (n + 1) : size * n;

  const selectedIds = useMemo(() => {
    return brushSelection?.selectedIds || new Set<number>();
  }, [brushSelection]);

  // Canvas rendering function
  const renderPointsToCanvas = useCallback((canvas: HTMLCanvasElement, data: DataPoint[], xScale: d3.ScaleLinear<number, number>, yScale: d3.ScaleLinear<number, number>, xCol: string, yCol: string, selectedIds: Set<number>, filterMode: FilterMode) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, size, size);

    if (colorState) {
      // Color-by paint path. The per-row color slot was precomputed once per
      // mode/column/data change (colorState.slotById, indexed by __id), so
      // the loop below only does typed-array lookups. Points are bucketed by
      // slot in a single pass and painted as one path per color, keeping the
      // number of fill calls bounded (10 categories / 64 gradient buckets)
      // regardless of row count.
      const { slotById, slotColors } = colorState;
      const numSlots = slotColors.length;
      const hasSelection = selectedIds.size > 0;

      // Flat coordinate buffers per slot; last bucket = missing/NaN rows.
      const coloredCoords: number[][] = Array.from({ length: numSlots + 1 }, () => []);
      const selectedCoords: number[][] = hasSelection
        ? Array.from({ length: numSlots + 1 }, () => [])
        : coloredCoords;
      const dimmedCoords: number[] = [];

      for (const d of data) {
        const x = cellValueToNumber(d[xCol]);
        const y = cellValueToNumber(d[yCol]);
        if (!isFinite(x) || !isFinite(y)) continue;

        const screenX = xScale(x);
        const screenY = yScale(y);
        const isSelected = hasSelection && selectedIds.has(d.__id);

        if (hasSelection && !isSelected) {
          // Unselected points keep the classic dimmed-gray treatment so the
          // selection stays readable even with many colors on screen.
          if (filterMode === 'highlight') dimmedCoords.push(screenX, screenY);
          continue;
        }

        // slot is undefined when __id is out of slotById's bounds (e.g. a
        // transient render where colorState lags a data swap); undefined
        // fails both sentinel checks, so guard it explicitly to avoid
        // selectedCoords[undefined].push crashing the paint loop.
        const slot = slotById[d.__id];
        const bucket = slot === undefined || slot === MISSING_SLOT || slot >= numSlots
          ? numSlots
          : slot;
        selectedCoords[bucket].push(screenX, screenY);
      }

      drawPointBatch(ctx, dimmedCoords, '#ccc', 0.3);
      const alpha = hasSelection ? 0.8 : 0.7;
      for (let s = 0; s < numSlots; s++) {
        drawPointBatch(ctx, selectedCoords[s], slotColors[s], alpha);
      }
      drawPointBatch(ctx, selectedCoords[numSlots], MISSING_COLOR, alpha);

      ctx.globalAlpha = 1;
      return;
    }

    // Render non-selected points first
    if (filterMode === 'highlight' || selectedIds.size === 0) {
      ctx.fillStyle = selectedIds.size > 0 ? '#ccc' : '#4b5563';
      ctx.globalAlpha = selectedIds.size > 0 ? 0.3 : 0.7;

      data.forEach(d => {
        if (selectedIds.size > 0 && selectedIds.has(d.__id)) return;

        const x = cellValueToNumber(d[xCol]);
        const y = cellValueToNumber(d[yCol]);
        if (!isFinite(x) || !isFinite(y)) return;

        const screenX = xScale(x);
        const screenY = yScale(y);

        ctx.beginPath();
        ctx.arc(screenX, screenY, 2.5, 0, 2 * Math.PI);
        ctx.fill();
      });
    }

    // Render selected points on top
    if (selectedIds.size > 0) {
      ctx.fillStyle = '#1e40af';
      ctx.globalAlpha = 0.8;

      data.forEach(d => {
        if (!selectedIds.has(d.__id)) return;

        const x = cellValueToNumber(d[xCol]);
        const y = cellValueToNumber(d[yCol]);
        if (!isFinite(x) || !isFinite(y)) return;

        const screenX = xScale(x);
        const screenY = yScale(y);

        ctx.beginPath();
        ctx.arc(screenX, screenY, 2.5, 0, 2 * Math.PI);
        ctx.fill();
      });
    }

    ctx.globalAlpha = 1;
  }, [size, colorState]);

  const { filteredData, selectedData } = useMemo(
    () => filterData(data, selectedIds, filterMode),
    [data, selectedIds, filterMode]
  );

  // Single data-identity version: bump whenever the data array reference
  // changes (ref-guarded, so it is idempotent under strict-mode double
  // renders). Two things depend on it: (1) distinct datasets can share
  // length and __id range (__id is just the row index), so length/first/last
  // alone cannot tell "file B, same shape" from "same file"; (2) value-only
  // updates (e.g. recomputed PCA scores on the same rows/ids) reuse the same
  // ids. Folding the version into dataStateHash means render keys — and the
  // ImageData snapshots keyed by them — can never resurrect pixels from a
  // previous dataset. Brush/selection changes reuse the same array, so
  // canvas caching stays effective for interaction.
  const dataVersionRef = useRef(0);
  const lastDataRef = useRef<DataPoint[]>(data);
  if (lastDataRef.current !== data) {
    dataVersionRef.current += 1;
    lastDataRef.current = data;
  }

  const dataStateHash = useMemo(() => {
    if (data.length === 0) return `v${dataVersionRef.current}-empty`;
    const firstId = data[0]?.__id ?? 0;
    const lastId = data[data.length - 1]?.__id ?? 0;
    return `v${dataVersionRef.current}-${data.length}-${firstId}-${lastId}`;
  }, [data]);

  const selectedStateHash = useMemo(() => computeSelectedStateHash(selectedIds), [selectedIds]);

  // Memoized per-cell pairwise stats (issues #50/#36): brush-driven repaints
  // in highlight mode reuse the same fit/correlation instead of re-scanning
  // all rows. Keys fold in everything the stats depend on: column pair,
  // scale types, data identity, and — in filter mode only, where the fitted
  // subset changes with the selection — the selection hash.
  const pairStatsCacheRef = useRef<Map<string, PairStats>>(new Map());

  // Reference-line + metrics overlay pass (issues #50/#36): drawn AFTER the
  // point pass onto the same canvas, inside the same paint task, so lines,
  // badges and border tints land in the cached ImageData snapshots too.
  // Deliberately a separate draw step — it never touches the
  // point-rendering code path.
  const drawReferenceLines = useCallback((
    canvas: HTMLCanvasElement,
    xScale: d3.ScaleLinear<number, number>,
    yScale: d3.ScaleLinear<number, number>,
    xColName: string,
    yColName: string,
    xLog: boolean,
    yLog: boolean,
    cellData: DataPoint[]
  ) => {
    const correlationActive = showCorrelation || tintCellBorders;
    if (!showIdentityLine && !showRegressionLine && !correlationActive) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Pairwise stats, memoized. The regression fit is needed for the
    // regression line AND for a Pearson badge/tint (r = sign(slope)·√r²);
    // Spearman is a separate rank pass, cached in the same entry.
    const needsFit = showRegressionLine || (correlationActive && correlationMetric === 'pearson');
    const needsSpearman = correlationActive && correlationMetric === 'spearman';
    let stats: PairStats | null = null;
    if (needsFit || needsSpearman) {
      const cache = pairStatsCacheRef.current;
      const statsKey = [
        xColName,
        yColName,
        xLog ? 'log' : 'linear',
        yLog ? 'log' : 'linear',
        dataStateHash,
        filterMode,
        filterMode === 'filter' ? selectedStateHash : '-',
      ].join('|');

      let entry = cache.get(statsKey);
      if (!entry) {
        if (cache.size >= PAIR_STATS_CACHE_MAX_ENTRIES) cache.clear();
        entry = {};
        cache.set(statsKey, entry);
      }
      if (needsFit && entry.fit === undefined) {
        entry.fit = fitRegression(cellData, xColName, yColName, xLog, yLog);
      }
      if (needsSpearman && entry.spearman === undefined) {
        entry.spearman = spearmanCorrelation(cellData, xColName, yColName, xLog, yLog);
      }
      stats = entry;
    }
    const fit = stats?.fit ?? null;
    // n < 2 (or zero variance) yields null → no badge, no tint.
    const corr: CorrelationResult | null = correlationActive
      ? correlationMetric === 'spearman'
        ? stats?.spearman ?? null
        : pearsonFromFit(fit)
      : null;

    ctx.save();
    // Clip to the cell so out-of-range regression segments never bleed out.
    ctx.beginPath();
    ctx.rect(0, 0, size, size);
    ctx.clip();
    ctx.lineWidth = 1;

    if (showIdentityLine) {
      const xd = xScale.domain();
      const yd = yScale.domain();
      const overlap = computeIdentityOverlap([xd[0], xd[1]], [yd[0], yd[1]]);
      if (overlap) {
        // y=x is only straight in screen space when both axes share a scale
        // type; under mixed linear/log it curves, so sample it in screen-x
        // and transform each sample through the cell's own scales.
        const px0 = xScale(overlap[0]);
        const px1 = xScale(overlap[1]);
        const steps = xLog === yLog
          ? 1
          : Math.max(2, Math.min(64, Math.ceil(Math.abs(px1 - px0) / 4)));

        ctx.strokeStyle = IDENTITY_LINE_COLOR;
        ctx.globalAlpha = 0.9;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        for (let s = 0; s <= steps; s++) {
          const px = px0 + ((px1 - px0) * s) / steps;
          const v = s === 0 ? overlap[0] : s === steps ? overlap[1] : xScale.invert(px);
          const py = yScale(v);
          if (s === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    if (showRegressionLine && fit) {
      // The fit lives in transformed space, where both screen axes are
      // affine — so the line is straight in screen space for every
      // linear/log combination. Map the transformed endpoints directly
      // (avoiding a pow(10, w) round-trip that could overflow).
      const xd = xScale.domain();
      const yd = yScale.domain();
      const xr = xScale.range();
      const yr = yScale.range();
      const u0 = xLog ? Math.log10(xd[0]) : xd[0];
      const u1 = xLog ? Math.log10(xd[1]) : xd[1];
      const t0 = yLog ? Math.log10(yd[0]) : yd[0];
      const t1 = yLog ? Math.log10(yd[1]) : yd[1];
      const wToScreenY = (w: number) => yr[0] + ((w - t0) / (t1 - t0)) * (yr[1] - yr[0]);

      ctx.strokeStyle = REGRESSION_LINE_COLOR;
      ctx.globalAlpha = REGRESSION_LINE_ALPHA;
      ctx.beginPath();
      ctx.moveTo(xr[0], wToScreenY(fit.slope * u0 + fit.intercept));
      ctx.lineTo(xr[1], wToScreenY(fit.slope * u1 + fit.intercept));
      ctx.stroke();
    }

    // Border tint by |r| (issue #36): a thin inset stroke whose opacity
    // encodes the correlation strength — transparent at |r|=0, strong at 1.
    if (tintCellBorders && corr) {
      const alpha = correlationBorderAlpha(Math.abs(corr.r));
      if (alpha > 0) {
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = CORRELATION_BORDER_COLOR;
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, size - 2, size - 2);
        ctx.lineWidth = 1;
      }
    }

    // Combined badge in the cell's top-right corner (one line — the r and
    // r² labels must never overlap), only in cells large enough that it
    // won't clutter the plot area.
    if (size >= BADGE_MIN_CELL_SIZE) {
      const badgeParts: string[] = [];
      if (showCorrelation && corr) {
        badgeParts.push(`${correlationMetric === 'spearman' ? 'ρ' : 'r'}=${corr.r.toFixed(2)}`);
      }
      if (showRegressionLine && fit) {
        badgeParts.push(`r²=${fit.r2.toFixed(2)}`);
      }
      if (badgeParts.length > 0) {
        ctx.font = '9px sans-serif';
        ctx.fillStyle = showRegressionLine && fit ? REGRESSION_LINE_COLOR : CORRELATION_BADGE_COLOR;
        ctx.globalAlpha = 0.8;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText(badgeParts.join('  '), size - padding / 2 - 2, padding / 2 + 2);
      }
    }

    ctx.restore();
    ctx.globalAlpha = 1;
  }, [showIdentityLine, showRegressionLine, showCorrelation, correlationMetric, tintCellBorders, size, padding, dataStateHash, filterMode, selectedStateHash]);

  // Compute stats from appropriate dataset: filtered data when in filter mode with selection, otherwise full data
  const dataForStats = useMemo(() => {
    return (filterMode === 'filter' && selectedIds.size > 0) ? filteredData : data;
  }, [filterMode, selectedIds.size, filteredData, data]);

  const columnStats = useMemo(() => {
    const stats = new Map<string, { min: number; max: number; minPositive: number }>();
    visibleColumns.forEach(col => {
      stats.set(col.name, { min: Infinity, max: -Infinity, minPositive: Infinity });
    });

    if (visibleColumns.length === 0) {
      return stats;
    }

    for (const row of dataForStats) {
      for (const col of visibleColumns) {
        const value = cellValueToNumber(row[col.name]);
        if (!isFinite(value)) continue;
        const columnStat = stats.get(col.name);
        if (!columnStat) continue;
        if (value < columnStat.min) columnStat.min = value;
        if (value > columnStat.max) columnStat.max = value;
        if (value > 0 && value < columnStat.minPositive) columnStat.minPositive = value;
      }
    }

    visibleColumns.forEach(col => {
      const stat = stats.get(col.name);
      if (!stat) return;
      if (!isFinite(stat.min)) stat.min = 0;
      if (!isFinite(stat.max)) stat.max = 1;
      if (!isFinite(stat.minPositive)) stat.minPositive = Math.max(1e-9, stat.max);
      if (stat.min === stat.max) {
        stat.min = stat.min - 1;
        stat.max = stat.max + 1;
      }
    });

    return stats;
  }, [dataForStats, visibleColumns]);

  const createScale = useCallback(
    (column: Column, range: [number, number]) => {
      const stat = columnStats.get(column.name);
      const defaultDomain: [number, number] = [0, 1];

      if (!stat) {
        return d3.scaleLinear().domain(defaultDomain).range(range);
      }

      if (column.scale === 'log') {
        const start = isFinite(stat.minPositive) ? stat.minPositive : 1e-9;
        const end = stat.max > start ? stat.max : start * 10;
        return d3.scaleLog().domain([start, end]).range(range);
      }

      return d3.scaleLinear().domain([stat.min, stat.max]).range(range);
    },
    [columnStats]
  );

  const xScales = useMemo(
    () => visibleColumns.map(col => createScale(col, [padding / 2, size - padding / 2])),
    [visibleColumns, createScale, padding, size]
  );

  const yScales = useMemo(
    () => visibleColumns.map(col => createScale(col, [size - padding / 2, padding / 2])),
    [visibleColumns, createScale, padding, size]
  );

  const cellCoordinates = useMemo(() => d3.cross(d3.range(n), d3.range(n)), [n]);
  const headerIndices = useMemo(() => d3.range(n), [n]);

  // Drag optimization callbacks
  const handleDragStart = useCallback(() => {
    isDraggingRef.current = true;
  }, []);

  const handleDragEnd = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  useEffect(() => {
    if (!ref.current || data.length === 0) return;

    // Helper function to get mouse position relative to SVG
    const getMousePosition = (event: d3.D3BrushEvent<unknown>) => {
      if (!event.sourceEvent || !ref.current) return null;
      const svgRect = ref.current.getBoundingClientRect();
      return {
        x: event.sourceEvent.clientX - svgRect.left,
        y: event.sourceEvent.clientY - svgRect.top,
      };
    };

    // Typed wrapper functions for D3 brush operations
    const callBrushMove = (selection: d3.Selection<SVGGElement | d3.BaseType, unknown, null, undefined>, brush: d3.BrushBehavior<unknown>, selectionData: [[number, number], [number, number]] | null) => {
      selection.call(brush.move as any, selectionData);
    };

    const callBrushXMove = (selection: d3.Selection<SVGGElement | d3.BaseType, unknown, null, undefined>, brush: d3.BrushBehavior<unknown>, selectionData: [number, number] | null) => {
      selection.call(brush.move as any, selectionData);
    };

    const callBrushYMove = (selection: d3.Selection<SVGGElement | d3.BaseType, unknown, null, undefined>, brush: d3.BrushBehavior<unknown>, selectionData: [number, number] | null) => {
      selection.call(brush.move as any, selectionData);
    };

    // During drag, we'll update layout but skip expensive canvas re-rendering

    const svg = d3.select(ref.current);
    svg.selectAll("*").remove(); // Clear previous render

    const createScale = (c: Column, range: [number, number]) => {
      // Force coercion to number and filter out non-finite values
      const values = data.map(d => cellValueToNumber(d[c.name])).filter(isFinite);
      const extent = d3.extent(values);

      let domain: [number, number] = [0, 1];
      if (extent[0] !== undefined && extent[1] !== undefined) {
        domain = extent as [number, number];
      }

      if (c.scale === 'log') {
        const start = Math.max(1e-9, domain[0]);
        let end = Math.max(1e-9, domain[1]);
        if (start >= end) {
          end = start * 10;
        }
        domain = [start, end];
        return d3.scaleLog().domain(domain).range(range);
      }

      if (domain[0] === domain[1]) {
        domain = [domain[0] - 1, domain[1] + 1];
      }

      return d3.scaleLinear().domain(domain).range(range);
    };

    if (n === 0) return; // Don't render if no columns are visible

    const cell = svg.append("g")
      .selectAll("g")
      .data(cellCoordinates)
      .join("g")
      .attr("transform", ([i, j]) => `translate(${i * size},${j * size})`)
      .attr("data-index-i", ([i, _]) => i)
      .attr("data-index-j", ([_, j]) => j);

    const brushableCells = cell.filter(([i, j]) => i !== j);
    let histCellsBottom: d3.Selection<SVGGElement, number, SVGGElement, unknown> | null = null;
    let histCellsRight: d3.Selection<SVGGElement, number, SVGGElement, unknown> | null = null;

    const brush = d3.brush<unknown>().extent([[0, 0], [size, size]]);
    const brushX = d3.brushX<number>().extent([[0, 0], [size, size]]);
    const brushY = d3.brushY<number>().extent([[0, 0], [size, size]]);

    brush
      .on("start", function (event) {
        if (!event.sourceEvent) return;
        setCoordinateDisplay(prev => ({ ...prev, visible: true }));
      })
      .on("brush", function (event) {
        if (!event.sourceEvent) return;

        // Get the [i, j] data bound to this cell
        const cellData = d3.select(this).datum() as [number, number];
        if (!cellData || cellData.length !== 2) return;

        const [i_visible, j_visible] = cellData;
        const i_original = visibleIndexToOriginalIndex.get(i_visible);
        const j_original = visibleIndexToOriginalIndex.get(j_visible);

        if (i_original === undefined || j_original === undefined) return;

        const colX = columns[i_original];
        const colY = columns[j_original];
        if (!colX || !colY) return;

        // Get current mouse position relative to the SVG
        const mousePos = getMousePosition(event);
        if (!mousePos) return;

        // Calculate cell position
        const cellX = i_visible * size;
        const cellY = j_visible * size;

        // Convert mouse position to cell-relative coordinates
        const cellRelativeX = mousePos.x - cellX;
        const cellRelativeY = mousePos.y - cellY;

        // Convert to data values
        const xValue = xScales[i_visible].invert(cellRelativeX);
        const yValue = yScales[j_visible].invert(cellRelativeY);

        setCoordinateDisplay({
          visible: true,
          x: mousePos.x,
          y: mousePos.y,
          xValue: xValue,
          yValue: yValue,
          xColumn: colX.name,
          yColumn: colY.name
        });
      })
      .on("end", function (event) {
        if (!event.sourceEvent) return; // Ignore programmatic brushes

        setCoordinateDisplay(prev => ({ ...prev, visible: false }));

        if (!event.selection) {
          onBrush(null);
          return;
        }

        // Get the [i, j] data bound to this cell
        const cellData = d3.select(this).datum() as [number, number];
        if (!cellData || cellData.length !== 2) return;

        const [i_visible, j_visible] = cellData;
        const i_original = visibleIndexToOriginalIndex.get(i_visible);
        const j_original = visibleIndexToOriginalIndex.get(j_visible);

        if (i_original === undefined || j_original === undefined) return;

        const [[x0, y0], [x1, y1]] = event.selection;

        const colX = columns[i_original];
        const colY = columns[j_original];
        if (!colX || !colY) return;

        // Create spatial grid for fast selection
        const grid = createSpatialGrid(data, xScales[i_visible], yScales[j_visible], colX.name, colY.name, size);
        const newSelectedIds = getPointsInBrush(grid, xScales[i_visible], yScales[j_visible], x0, y0, x1, y1, colX.name, colY.name, size);
        onBrush({ indexX: i_original, indexY: j_original, x0, y0, x1, y1, selectedIds: newSelectedIds });
      });

    brushableCells.call(brush);

    // Create canvas elements for point rendering
    if (!canvasContainerRef.current) return;

    const activeCanvases = new Set<string>();
    const container = canvasContainerRef.current;

    // Collect cells that need repainting instead of painting them
    // synchronously; they are painted in RAF-budgeted chunks below so the
    // main thread stays responsive during large renders.
    interface PaintTask {
      canvas: HTMLCanvasElement;
      canvasKey: string;
      renderKey: string;
      xScale: d3.ScaleLinear<number, number>;
      yScale: d3.ScaleLinear<number, number>;
      xColName: string;
      yColName: string;
      xLog: boolean;
      yLog: boolean;
    }
    const paintTasks: PaintTask[] = [];

    // Snapshots are only valid for the dataset they were rendered from:
    // drop them all when the data changes.
    if (snapshotDataHashRef.current !== dataStateHash) {
      snapshotCachesRef.current.clear();
      snapshotDataHashRef.current = dataStateHash;
    }

    brushableCells.each(function ([i, j]) {
      const i_original = visibleIndexToOriginalIndex.get(i);
      const j_original = visibleIndexToOriginalIndex.get(j);
      if (i_original === undefined || j_original === undefined) return;

      const colX = columns[i_original];
      const colY = columns[j_original];
      if (!colX || !colY) return;

      const canvasKey = `${colX.name}-${colY.name}`;
      activeCanvases.add(canvasKey);

      let canvas = canvasElementsRef.current.get(canvasKey);
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        canvas.style.position = 'absolute';
        canvas.style.pointerEvents = 'none';
        canvasElementsRef.current.set(canvasKey, canvas);
      }

      // Update canvas dimensions if size changed
      if (canvas.width !== size || canvas.height !== size) {
        canvas.width = size;
        canvas.height = size;
      }

      if (!canvas.isConnected) {
        container.appendChild(canvas);
      }

      canvas.style.left = `${i * size}px`;
      canvas.style.top = `${j * size}px`;

      const renderKey = buildRenderKey({
        xColName: colX.name,
        yColName: colY.name,
        xScale: colX.scale,
        yScale: colY.scale,
        filterMode,
        dataStateHash,
        selectedStateHash,
        size,
        showIdentityLine,
        showRegressionLine,
        showCorrelation,
        tintCellBorders,
        correlationMetric,
        colorStateHash: colorState?.hash ?? 'none',
      });
      const previousKey = canvasRenderKeyRef.current.get(canvasKey);

      if (!isDraggingRef.current && previousKey !== renderKey) {
        // LRU hit: restore a previously-seen configuration instantly
        // instead of re-plotting every point. Snapshots are unselected-state
        // only, so only consult the cache when nothing is selected.
        const cached = selectedIds.size === 0
          ? snapshotCachesRef.current.get(canvasKey)?.get(renderKey)
          : undefined;
        const ctx = cached ? canvas.getContext('2d') : null;
        if (cached && ctx && typeof ctx.putImageData === 'function') {
          ctx.putImageData(cached, 0, 0);
          canvasRenderKeyRef.current.set(canvasKey, renderKey);
        } else {
          paintTasks.push({
            canvas,
            canvasKey,
            renderKey,
            xScale: xScales[i],
            yScale: yScales[j],
            xColName: colX.name,
            yColName: colY.name,
            xLog: colX.scale === 'log',
            yLog: colY.scale === 'log',
          });
        }
      }
    });

    // Remove canvases for columns that are no longer visible
    const canvasesToRemove: string[] = [];
    canvasElementsRef.current.forEach((canvas, key) => {
      if (!activeCanvases.has(key)) {
        canvas.remove();
        canvasesToRemove.push(key);
      }
    });

    canvasesToRemove.forEach(key => {
      canvasElementsRef.current.delete(key);
      canvasRenderKeyRef.current.delete(key);
      snapshotCachesRef.current.delete(key);
    });

    const diagonalCells = cell.filter(([i, j]) => i === j);

    diagonalCells.each(function ([i]) {
      const g = d3.select(this);

      // Add a data-testid to the diagonal cell for easy selection in tests
      const originalIndex = visibleIndexToOriginalIndex.get(i);
      if (originalIndex !== undefined) {
        const columnName = columns[originalIndex].name;
        g.attr('data-testid', `diagonal-cell-${columnName}`);
      }

      // Left Axis
      const leftAxis = d3.axisLeft(yScales[i]).ticks(4).tickSize(5).tickPadding(-4);
      g.append("g")
        .attr("transform", `translate(${padding / 2}, 0)`)
        .call(leftAxis)
        .call(axis => {
          axis.select(".domain").remove();
          axis.selectAll(".tick line")
            .style("stroke", "#3f3f46");
          axis.selectAll("text")
            .style("text-anchor", "start")
            .style("font-size", "10px")
            .style("fill", "#3f3f46");
        });
    });

    if (showHistograms) {
      brushX
        .on("start", function (event) {
          if (!event.sourceEvent) return;
          setCoordinateDisplay(prev => ({ ...prev, visible: true }));
        })
        .on("brush", function (event) {
          if (!event.sourceEvent) return;

          const i_visible = d3.select(this).datum() as number;
          if (i_visible === undefined) return;

          const i_original = visibleIndexToOriginalIndex.get(i_visible);
          if (i_original === undefined || !columns[i_original]) return;

          const column = columns[i_original];

          // Get current mouse position relative to the SVG
          const mousePos = getMousePosition(event);
          if (!mousePos) return;

          // Calculate histogram cell position
          const cellX = i_visible * size;
          const cellY = n * size; // Histograms are at the bottom

          // Convert mouse position to cell-relative coordinates
          const cellRelativeX = mousePos.x - cellX;

          // Convert to data value
          const xValue = xScales[i_visible].invert(cellRelativeX);

          setCoordinateDisplay({
            visible: true,
            x: mousePos.x,
            y: mousePos.y,
            xValue: xValue,
            yValue: null,
            xColumn: column.name,
            yColumn: null
          });
        })
        .on("end", function (event) {
          if (!event.sourceEvent) return;

          setCoordinateDisplay(prev => ({ ...prev, visible: false }));

          const i_visible = d3.select(this).datum() as number;
          if (i_visible === undefined) return;

          const i_original = visibleIndexToOriginalIndex.get(i_visible);
          if (i_original === undefined || !columns[i_original]) return;

          if (!event.selection) { onBrush(null); return; }

          const [x0, x1] = event.selection;
          // Faster selection for histogram brush
          const newSelectedIds = new Set<number>();
          const minVal = xScales[i_visible].invert(x0);
          const maxVal = xScales[i_visible].invert(x1);
          for (const d of data) {
            const val = +d[columns[i_original].name];
            if (val >= minVal && val <= maxVal) newSelectedIds.add(d.__id);
          }
          onBrush({ indexX: i_original, indexY: columns.length, x0, y0: padding / 2, x1, y1: size - padding / 2, selectedIds: newSelectedIds });
        });

      histCellsBottom = svg.append("g").selectAll("g").data(d3.range(n)).join("g")
        .attr("transform", i => `translate(${i * size}, ${n * size})`)
        .attr("data-index", i => i) as d3.Selection<SVGGElement, number, SVGGElement, unknown>;

      histCellsBottom.call(brushX);

      histCellsBottom.each(function (i_visible) {
        const i_original = visibleIndexToOriginalIndex.get(i_visible)!;
        const column = columns[i_original];

        const domain = xScales[i_visible].domain();
        const minDomain = Math.min(domain[0], domain[1]);
        const maxDomain = Math.max(domain[0], domain[1]);

        // Uniform bins in log space if requested and using log scale
        let thresholds: number | number[] = 20;
        if (useUniformLogBins && column.scale === 'log') {
          const logMin = Math.log10(Math.max(minDomain, 1e-10));
          const logMax = Math.log10(maxDomain);
          const numBins = 20;
          const logStep = (logMax - logMin) / numBins;
          thresholds = Array.from({ length: numBins + 1 }, (_, i) => Math.pow(10, logMin + i * logStep));
        }

        const g = d3.select(this);
        const binX0 = (d: { x0?: number }) => xScales[i_visible](d.x0!)! + 1;
        const binWidth = (d: { x0?: number, x1?: number }) =>
          Math.max(0, xScales[i_visible](d.x1!)! - xScales[i_visible](d.x0!)! - 1);

        if (colorState) {
          // Issue #40: with a color mode active, each bar becomes a stacked
          // bar segmented by point color (categories, or ~12 gradient
          // buckets for rainbow). Bins keep row identity so each row lands
          // in its color stack.
          const rowBinGenBase = d3.bin<DataPoint, number>()
            .value(d => cellValueToNumber(d[column.name]))
            .domain([minDomain, maxDomain]);
          const rowBinGen = Array.isArray(thresholds)
            ? rowBinGenBase.thresholds(thresholds)
            : rowBinGenBase.thresholds(thresholds);
          // isFiniteCellValue (not isFinite(+v)): +null === 0, which would
          // bin rows with missing cells as real zeros. See histogramStackUtils.
          const rowBins = rowBinGen(filteredData.filter(d => isFiniteCellValue(d[column.name])));

          const config = getStackConfig(colorState);
          const { total, selected } = computeStackedBinCounts(rowBins, colorState, config, selectedIds);
          const binTotals = total.map(stacks => stacks.reduce((a, b) => a + b, 0));
          const yHist = d3.scaleLinear().domain([0, d3.max(binTotals) || 1]).range([size - padding / 2, padding / 2]);
          const hasSelection = selectedIds.size > 0;

          // Selection readability: keep the stacking but dim the full-data
          // segments; the selected rows are re-stacked opaquely from the
          // baseline on top (mirrors the classic gray/blue overlay).
          g.selectAll("rect.stack-total").data(buildStackSegments(total, config.stackColors)).join("rect")
            .attr("class", "stack-total")
            .attr("x", seg => binX0(rowBins[seg.binIndex]))
            .attr("width", seg => binWidth(rowBins[seg.binIndex]))
            .attr("y", seg => yHist(seg.end)!)
            .attr("height", seg => Math.max(0, yHist(seg.start)! - yHist(seg.end)!))
            .attr("fill", seg => seg.color)
            .attr("fill-opacity", hasSelection ? 0.25 : 0.9);

          if (hasSelection) {
            g.selectAll("rect.stack-selected").data(buildStackSegments(selected, config.stackColors)).join("rect")
              .attr("class", "stack-selected")
              .attr("x", seg => binX0(rowBins[seg.binIndex]))
              .attr("width", seg => binWidth(rowBins[seg.binIndex]))
              .attr("y", seg => yHist(seg.end)!)
              .attr("height", seg => Math.max(0, yHist(seg.start)! - yHist(seg.end)!))
              .attr("fill", seg => seg.color);
          }
          return;
        }

        const allValues = filteredData.map(d => cellValueToNumber(d[column.name])).filter(isFinite);
        const selectedValues = selectedData.map(d => cellValueToNumber(d[column.name])).filter(isFinite);

        const binGeneratorBase = d3.bin().domain([minDomain, maxDomain]);
        const binGenerator = Array.isArray(thresholds)
          ? binGeneratorBase.thresholds(thresholds)
          : binGeneratorBase.thresholds(thresholds);

        const allBins = binGenerator(allValues);
        const selectedBins = binGenerator(selectedValues);

        const combinedBins: HistogramBin[] = allBins.map((bin, index) => ({
          x0: bin.x0!,
          x1: bin.x1!,
          totalLength: bin.length,
          selectedLength: selectedBins[index]?.length || 0
        }));

        const yHist = d3.scaleLinear().domain([0, d3.max(combinedBins, d => d.totalLength) || 1]).range([size - padding / 2, padding / 2]);

        g.selectAll("rect.total").data(combinedBins).join("rect").attr("class", "total")
          .attr("x", d => binX0(d))
          .attr("width", d => binWidth(d))
          .attr("y", d => yHist(d.totalLength)!)
          .attr("height", d => size - padding / 2 - yHist(d.totalLength)!)
          .attr("fill", selectedIds.size > 0 ? "#ccc" : "#60a5fa");

        g.selectAll("rect.selected").data(combinedBins).join("rect").attr("class", "selected")
          .attr("x", d => binX0(d))
          .attr("width", d => binWidth(d))
          .attr("y", d => yHist(d.selectedLength)!)
          .attr("height", d => size - padding / 2 - yHist(d.selectedLength)!)
          .attr("fill", "#1e40af");
      });

      brushY
        .on("start", function (event) {
          if (!event.sourceEvent) return;
          setCoordinateDisplay(prev => ({ ...prev, visible: true }));
        })
        .on("brush", function (event) {
          if (!event.sourceEvent) return;

          const j_visible = d3.select(this).datum() as number;
          if (j_visible === undefined) return;

          const j_original = visibleIndexToOriginalIndex.get(j_visible);
          if (j_original === undefined || !columns[j_original]) return;

          const column = columns[j_original];

          // Get current mouse position relative to the SVG
          const mousePos = getMousePosition(event);
          if (!mousePos) return;

          // Calculate histogram cell position
          const cellX = n * size; // Histograms are on the right
          const cellY = j_visible * size;

          // Convert mouse position to cell-relative coordinates
          const cellRelativeY = mousePos.y - cellY;

          // Convert to data value
          const yValue = yScales[j_visible].invert(cellRelativeY);

          setCoordinateDisplay({
            visible: true,
            x: mousePos.x,
            y: mousePos.y,
            xValue: null,
            yValue: yValue,
            xColumn: null,
            yColumn: column.name
          });
        })
        .on("end", function (event) {
          if (!event.sourceEvent) return;

          setCoordinateDisplay(prev => ({ ...prev, visible: false }));

          const j_visible = d3.select(this).datum() as number;
          if (j_visible === undefined) return;

          const j_original = visibleIndexToOriginalIndex.get(j_visible);
          if (j_original === undefined || !columns[j_original]) return;

          if (!event.selection) { onBrush(null); return; }

          const [y0, y1] = event.selection;
          const newSelectedIds = new Set<number>();
          // Faster selection for Y histogram brush
          const minVal = yScales[j_visible].invert(y1);
          const maxVal = yScales[j_visible].invert(y0);
          for (const d of data) {
            const val = +d[columns[j_original].name];
            if (val >= minVal && val <= maxVal) newSelectedIds.add(d.__id);
          }
          onBrush({ indexX: columns.length, indexY: j_original, x0: padding / 2, y0, x1: size - padding / 2, y1, selectedIds: newSelectedIds });
        });

      histCellsRight = svg.append("g").selectAll("g").data(d3.range(n)).join("g")
        .attr("transform", i => `translate(${n * size}, ${i * size})`)
        .attr("data-index", i => i) as d3.Selection<SVGGElement, number, SVGGElement, unknown>;

      histCellsRight.call(brushY);

      histCellsRight.each(function (j_visible) {
        const j_original = visibleIndexToOriginalIndex.get(j_visible)!;
        const column = columns[j_original];

        const domain = yScales[j_visible].domain();
        const minDomain = Math.min(domain[0], domain[1]);
        const maxDomain = Math.max(domain[0], domain[1]);

        // Uniform bins in log space if requested and using log scale
        let thresholds: number | number[] = 20;
        if (useUniformLogBins && column.scale === 'log') {
          const logMin = Math.log10(Math.max(minDomain, 1e-10));
          const logMax = Math.log10(maxDomain);
          const numBins = 20;
          const logStep = (logMax - logMin) / numBins;
          thresholds = Array.from({ length: numBins + 1 }, (_, i) => Math.pow(10, logMin + i * logStep));
        }

        const g = d3.select(this);
        const binY0 = (d: { x1?: number }) => yScales[j_visible](d.x1!)! + 1;
        const binHeight = (d: { x0?: number, x1?: number }) =>
          Math.max(0, yScales[j_visible](d.x0!)! - yScales[j_visible](d.x1!)! - 1);

        if (colorState) {
          // Issue #40: stacked-by-color bars (horizontal); see the bottom
          // histogram block for the full rationale.
          const rowBinGenBase = d3.bin<DataPoint, number>()
            .value(d => cellValueToNumber(d[column.name]))
            .domain([minDomain, maxDomain]);
          const rowBinGen = Array.isArray(thresholds)
            ? rowBinGenBase.thresholds(thresholds)
            : rowBinGenBase.thresholds(thresholds);
          // isFiniteCellValue (not isFinite(+v)): +null === 0, which would
          // bin rows with missing cells as real zeros. See histogramStackUtils.
          const rowBins = rowBinGen(filteredData.filter(d => isFiniteCellValue(d[column.name])));

          const config = getStackConfig(colorState);
          const { total, selected } = computeStackedBinCounts(rowBins, colorState, config, selectedIds);
          const binTotals = total.map(stacks => stacks.reduce((a, b) => a + b, 0));
          const xHist = d3.scaleLinear().domain([0, d3.max(binTotals) || 1]).range([padding / 2, size - padding / 2]);
          const hasSelection = selectedIds.size > 0;

          g.selectAll("rect.stack-total").data(buildStackSegments(total, config.stackColors)).join("rect")
            .attr("class", "stack-total")
            .attr("y", seg => binY0(rowBins[seg.binIndex]))
            .attr("height", seg => binHeight(rowBins[seg.binIndex]))
            .attr("x", seg => xHist(seg.start)!)
            .attr("width", seg => Math.max(0, xHist(seg.end)! - xHist(seg.start)!))
            .attr("fill", seg => seg.color)
            .attr("fill-opacity", hasSelection ? 0.25 : 0.9);

          if (hasSelection) {
            g.selectAll("rect.stack-selected").data(buildStackSegments(selected, config.stackColors)).join("rect")
              .attr("class", "stack-selected")
              .attr("y", seg => binY0(rowBins[seg.binIndex]))
              .attr("height", seg => binHeight(rowBins[seg.binIndex]))
              .attr("x", seg => xHist(seg.start)!)
              .attr("width", seg => Math.max(0, xHist(seg.end)! - xHist(seg.start)!))
              .attr("fill", seg => seg.color);
          }
          return;
        }

        const allValues = filteredData.map(d => cellValueToNumber(d[column.name])).filter(isFinite);
        const selectedValues = selectedData.map(d => cellValueToNumber(d[column.name])).filter(isFinite);

        const binGeneratorBase = d3.bin().domain([minDomain, maxDomain]);
        const binGenerator = Array.isArray(thresholds)
          ? binGeneratorBase.thresholds(thresholds)
          : binGeneratorBase.thresholds(thresholds);

        const allBins = binGenerator(allValues);
        const selectedBins = binGenerator(selectedValues);

        const combinedBins: HistogramBin[] = allBins.map((bin, index) => ({
          x0: bin.x0!,
          x1: bin.x1!,
          totalLength: bin.length,
          selectedLength: selectedBins[index]?.length || 0
        }));

        const xHist = d3.scaleLinear().domain([0, d3.max(combinedBins, d => d.totalLength) || 1]).range([padding / 2, size - padding / 2]);

        g.selectAll("rect.total").data(combinedBins).join("rect").attr("class", "total")
          .attr("y", d => binY0(d))
          .attr("height", d => binHeight(d))
          .attr("x", padding / 2)
          .attr("width", d => xHist(d.totalLength)! - padding / 2)
          .attr("fill", selectedIds.size > 0 ? "#ccc" : "#60a5fa");

        g.selectAll("rect.selected").data(combinedBins).join("rect").attr("class", "selected")
          .attr("y", d => binY0(d))
          .attr("height", d => binHeight(d))
          .attr("x", padding / 2)
          .attr("width", d => xHist(d.selectedLength)! - padding / 2)
          .attr("fill", "#1e40af");
      });
    }

    // Declaratively sync the brush visual state with the React state.
    brushableCells.each(function ([i_visible, j_visible]) {
      const i_original = visibleIndexToOriginalIndex.get(i_visible);
      const j_original = visibleIndexToOriginalIndex.get(j_visible);

      if (brushSelection && brushSelection.indexX === i_original && brushSelection.indexY === j_original) {
        callBrushMove(d3.select(this), brush, [[brushSelection.x0, brushSelection.y0], [brushSelection.x1, brushSelection.y1]]);
      } else {
        callBrushMove(d3.select(this), brush, null);
      }
    });

    if (showHistograms && histCellsBottom) {
      histCellsBottom.each(function (i_visible) {
        const i_original = visibleIndexToOriginalIndex.get(i_visible);
        if (brushSelection && brushSelection.indexX === i_original && brushSelection.indexY === columns.length) {
          callBrushXMove(d3.select(this), brushX, [brushSelection.x0, brushSelection.x1]);
        } else {
          callBrushXMove(d3.select(this), brushX, null);
        }
      });
    }

    if (showHistograms && histCellsRight) {
      histCellsRight.each(function (j_visible) {
        const j_original = visibleIndexToOriginalIndex.get(j_visible);
        if (brushSelection && brushSelection.indexX === columns.length && brushSelection.indexY === j_original) {
          callBrushYMove(d3.select(this), brushY, [brushSelection.y0, brushSelection.y1]);
        } else {
          callBrushYMove(d3.select(this), brushY, null);
        }
      });
    }

    // Paint the queued cells in RAF-budgeted chunks (~CELLS_PER_FRAME cells
    // or ~FRAME_BUDGET_MS per frame), then signal completion. The scheduler
    // is cancelable: if the config changes mid-render (or the component
    // unmounts) the effect cleanup cancels the pending frame, and because a
    // cell's render key is only recorded after a successful paint, any
    // unpainted cells are re-queued by the next effect run — no stale paints.
    let rafId: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const totalTasks = paintTasks.length;
    let tasksDone = 0;
    let framesUsed = 0;

    // After a cache miss is painted, snapshot the result so the same
    // configuration can be restored instantly later. Unselected-state only,
    // skipped for very large cells and once the global byte budget is hit.
    const maybeSnapshot = (task: PaintTask) => {
      if (selectedIds.size !== 0) return;
      if (size > SNAPSHOT_MAX_CELL_SIZE) return;
      const entryBytes = task.canvas.width * task.canvas.height * 4;
      if (totalSnapshotBytes(snapshotCachesRef.current) + entryBytes > SNAPSHOT_MAX_TOTAL_BYTES) return;
      const ctx = task.canvas.getContext('2d');
      if (!ctx || typeof ctx.getImageData !== 'function') return;
      try {
        let lru = snapshotCachesRef.current.get(task.canvasKey);
        if (!lru) {
          lru = new ImageDataLRU(SNAPSHOT_CAPACITY_PER_CELL);
          snapshotCachesRef.current.set(task.canvasKey, lru);
        }
        lru.set(task.renderKey, ctx.getImageData(0, 0, task.canvas.width, task.canvas.height));
      } catch {
        // getImageData can throw (e.g. tainted canvas, unsupported test env);
        // caching is an optimization only, so ignore and move on.
      }
    };

    const paintFrame = () => {
      rafId = null;
      if (cancelled) return;
      framesUsed++;

      const frameStart = performance.now();
      let paintedThisFrame = 0;
      while (
        tasksDone < totalTasks &&
        paintedThisFrame < CELLS_PER_FRAME &&
        performance.now() - frameStart < FRAME_BUDGET_MS
      ) {
        const task = paintTasks[tasksDone];
        renderPointsToCanvas(
          task.canvas,
          filteredData,
          task.xScale,
          task.yScale,
          task.xColName,
          task.yColName,
          selectedIds,
          filterMode
        );
        // Reference-line overlay: a separate draw step after the point pass,
        // still inside the same task so snapshots capture the full cell.
        drawReferenceLines(
          task.canvas,
          task.xScale,
          task.yScale,
          task.xColName,
          task.yColName,
          task.xLog,
          task.yLog,
          filteredData
        );
        canvasRenderKeyRef.current.set(task.canvasKey, task.renderKey);
        maybeSnapshot(task);
        tasksDone++;
        paintedThisFrame++;
      }

      // Stream progress once a render actually spans more than one frame —
      // whether because there are many cells or because a few point-heavy
      // cells blow the frame budget. Single-frame paints finish before the
      // indicator could usefully update, so they stay silent.
      if (framesUsed > 1 || tasksDone < totalTasks) {
        onRenderProgress?.(tasksDone, totalTasks);
      }

      if (tasksDone < totalTasks) {
        rafId = requestAnimationFrame(paintFrame);
      } else {
        onRenderComplete?.();
      }
    };

    if (totalTasks > 0) {
      rafId = requestAnimationFrame(paintFrame);
    } else {
      // Nothing to paint — signal completion after the browser paints,
      // matching the previous synchronous behavior.
      timeoutId = setTimeout(() => onRenderComplete?.(), 0);
    }

    return () => {
      cancelled = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (timeoutId !== null) clearTimeout(timeoutId);
    };
  }, [data, columns, onBrush, filteredData, selectedData, selectedIds, size, padding, n, showHistograms, useUniformLogBins, filterMode, brushSelection, visibleColumns, visibleIndexToOriginalIndex, renderPointsToCanvas, drawReferenceLines, showIdentityLine, showRegressionLine, showCorrelation, tintCellBorders, correlationMetric, xScales, yScales, cellCoordinates, dataStateHash, selectedStateHash, colorState, onRenderComplete, onRenderProgress]);

  return (
    <div
      ref={rootRef}
      className="w-full h-full relative"
      style={zoomGesture ? {
        transform: `scale(${zoomGesture.scale})`,
        transformOrigin: zoomGesture.origin,
        willChange: 'transform',
      } : undefined}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: plotSize,
          height: plotSize,
          pointerEvents: 'none'
        }}
      >
        {headerIndices.map(i => {
          const originalIndex = visibleIndexToOriginalIndex.get(i);
          if (originalIndex === undefined) return null;
          const column = columns[originalIndex];
          return (
            <div
              key={column.name}
              style={{
                position: 'absolute',
                left: i * size,
                top: i * size,
                width: size,
                height: size,
                pointerEvents: 'auto'
              }}
            >
              <DraggableHeader
                name={column.name}
                index={originalIndex}
                onColumnReorder={onColumnReorder}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onLabelClick={colorState?.mode === 'rainbow' ? onColumnLabelClick : undefined}
                labelClickHint={
                  colorState?.mode === 'rainbow'
                    ? column.name === rainbowOrderColumn
                      ? 'Rainbow gradient is ordered by this column. Click to revert to file order.'
                      : "Click to order the rainbow gradient by this column's rank"
                    : null
                }
                isRainbowOrderColumn={
                  colorState?.mode === 'rainbow' && column.name === rainbowOrderColumn
                }
              />
            </div>
          );
        })}
      </div>
      {/* Canvas container for high-performance point rendering */}
      <div
        ref={canvasContainerRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: plotSize,
          height: plotSize,
          pointerEvents: 'none'
        }}
      />
      <svg id="scatterplot-matrix-svg" ref={ref} width={plotSize} height={plotSize}></svg>

      {/* Coordinate Display */}
      {coordinateDisplay.visible && (
        <div
          style={{
            position: 'absolute',
            left: Math.min(coordinateDisplay.x + TOOLTIP_OFFSET, plotSize - TOOLTIP_WIDTH),
            top: Math.max(coordinateDisplay.y - TOOLTIP_HEIGHT, TOOLTIP_OFFSET),
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            color: 'white',
            padding: '8px 12px',
            borderRadius: '4px',
            fontSize: '12px',
            fontFamily: 'monospace',
            pointerEvents: 'none',
            zIndex: 1000,
            minWidth: '150px'
          }}
        >
          {coordinateDisplay.xColumn && (
            <div>
              <strong>{coordinateDisplay.xColumn}:</strong> {coordinateDisplay.xValue?.toFixed(3)}
            </div>
          )}
          {coordinateDisplay.yColumn && (
            <div>
              <strong>{coordinateDisplay.yColumn}:</strong> {coordinateDisplay.yValue?.toFixed(3)}
            </div>
          )}
        </div>
      )}
    </div>
  );
};