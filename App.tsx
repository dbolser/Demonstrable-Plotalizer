import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import Papa from 'papaparse';
import { FileUpload } from './components/FileUpload';
import { ControlPanel } from './components/ControlPanel';
import { ScatterPlotMatrix } from './components/ScatterPlotMatrix';
import { Tooltip } from './components/Tooltip';
import { DataTable } from './components/DataTable';
import type { DataPoint, Column, ScaleType, BrushSelection, FilterMode, ColorMode } from './types';
import { computeColorState } from './src/utils/colorUtils';
import { GitHubIcon } from './components/icons';
import { reorderColumns, filterColumns, restoreColumnOrder } from './src/utils/columnUtils';
import { sortColumnsByCorrelation } from './src/utils/correlationUtils';
import type { CorrelationKind } from './src/utils/correlationUtils';
import { detectColumnGroups } from './src/utils/groupUtils';
import { saveFile, getHistory, deleteEntry } from './src/utils/fileHistory';
import type { FileHistoryEntry } from './src/utils/fileHistory';
import { fetchCsvFromUrl, getDataUrlFromQuery } from './src/utils/urlLoader';
import { UrlInput } from './components/UrlInput';
import { computePCA, projectPCA, PCA_COLUMN_NAMES } from './src/utils/pca';
import { detectColumnTypes } from './src/utils/columnTypeUtils';
import { stepCellSize } from './src/utils/zoomUtils';
import type { PCAVarianceEntry } from './components/ControlPanel';
import { clampTableHeight, computeDragHeight, isTableVisible, capTableRows } from './src/utils/tableLayout';

const MAX_INITIAL_RENDER_POINTS = 15_000;

const App: React.FC = () => {
  const [data, setData] = useState<DataPoint[]>([]);
  // baseColumns = ground truth for manual visibility; displayColumns is derived
  const [columns, setColumns] = useState<Column[]>([]);
  const [stringColumns, setStringColumns] = useState<string[]>([]);
  const [labelColumn, setLabelColumn] = useState<string | null>(null);
  const [brushSelection, setBrushSelection] = useState<BrushSelection | null>(null);
  const [filterMode, setFilterMode] = useState<FilterMode>('highlight');
  const [showHistograms, setShowHistograms] = useState<boolean>(true);
  const [useUniformLogBins, setUseUniformLogBins] = useState<boolean>(false);
  const [globalLogScale, setGlobalLogScale] = useState<boolean>(false);
  // Issue #50: per-cell reference line toggles (both default off)
  const [showIdentityLine, setShowIdentityLine] = useState<boolean>(false);
  const [showRegressionLine, setShowRegressionLine] = useState<boolean>(false);
  // Issue #36: per-cell correlation metrics (all default off / Pearson)
  const [showCorrelation, setShowCorrelation] = useState<boolean>(false);
  const [tintCellBorders, setTintCellBorders] = useState<boolean>(false);
  const [correlationMetric, setCorrelationMetric] = useState<CorrelationKind>('pearson');
  // Column order saved before "sort columns by |r|" so it can be restored.
  const [preSortColumns, setPreSortColumns] = useState<Column[] | null>(null);
  const [columnFilter, setColumnFilter] = useState<string>('');
  const [isRecalculating, setIsRecalculating] = useState<boolean>(false);
  const [renderProgress, setRenderProgress] = useState<{ done: number; total: number } | null>(null);
  const [columnLimitNotice, setColumnLimitNotice] = useState<string | null>(null);
  const [cellSize, setCellSize] = useState<number>(150);
  const [showColumnGroups, setShowColumnGroups] = useState<boolean>(false);
  const [columnGroups, setColumnGroups] = useState<Map<string, string[]>>(new Map());
  const [recentFiles, setRecentFiles] = useState<FileHistoryEntry[]>([]);
  const [urlLoadError, setUrlLoadError] = useState<string | null>(null);
  const [isUrlLoading, setIsUrlLoading] = useState<boolean>(false);
  const [pcaVariance, setPcaVariance] = useState<PCAVarianceEntry[] | null>(null);
  // Issue #39: point coloring. rainbowOrderColumn = null means file order.
  const [colorMode, setColorMode] = useState<ColorMode>('none');
  const [categoryColorColumn, setCategoryColorColumn] = useState<string | null>(null);
  const [rainbowOrderColumn, setRainbowOrderColumn] = useState<string | null>(null);

  // Monotonic id for data loads. A single counter guards every async stage:
  // remote fetches (URL/sample) capture the id before awaiting and drop stale
  // responses, and worker-based CSV parsing captures the id before the RAF
  // defer / Papa.parse call and drops stale completions. Any newer load bumps
  // the counter, so a slow earlier fetch or parse can never overwrite the
  // dataset the user most recently chose (or clear its loading indicator).
  const loadRequestIdRef = useRef(0);

  const [tooltip, setTooltip] = useState<{ visible: boolean; content: string; x: number; y: number }>({
    visible: false,
    content: '',
    x: 0,
    y: 0,
  });

  // B5: displayColumns is derived from base columns + current filter (non-destructive)
  const displayColumns = useMemo(
    () => filterColumns(columns, columnFilter),
    [columns, columnFilter]
  );

  const visibleDisplayCount = useMemo(
    () => displayColumns.filter(c => c.visible).length,
    [displayColumns]
  );

  // Load recent files from IndexedDB on mount
  useEffect(() => {
    getHistory().then(setRecentFiles).catch(err => console.error('Failed to load file history:', err));
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setBrushSelection(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Apply a completed parse result to app state.
  const applyParseResult = useCallback((result: Papa.ParseResult<DataPoint>) => {
    if (result.errors.length > 0) {
      console.error("CSV Parsing errors:", result.errors);
      alert("Error parsing CSV file. Check console for details.");
      setIsRecalculating(false);
      return;
    }

    const rawData = result.data;
    if (rawData.length === 0) {
      setData([]);
      setColumns([]);
      setStringColumns([]);
      setLabelColumn(null);
      setIsRecalculating(false);
      return;
    }

    const dataWithIds = rawData.map((d, i) => ({ ...d, __id: i }));
    setData(dataWithIds);

    // B4 + hotfix: detect column types across ALL rows, not just row 0 —
    // sparse columns (e.g. PCA scores blank in early rows) parse as null
    // there and were previously dropped from both lists entirely.
    const detected = detectColumnTypes(dataWithIds, result.meta.fields);
    const allStringCols = detected.stringColumns;
    setStringColumns(allStringCols);
    setLabelColumn(allStringCols[0] || null);

    const numericColumns = detected.numericColumns.map(key => ({
      name: key,
      scale: 'linear' as ScaleType,
      visible: true,
    }));

    // Batch 3: Auto-limit columns on large load
    const rows = dataWithIds.length;
    const cols = numericColumns.length;
    if (rows * cols > MAX_INITIAL_RENDER_POINTS) {
      const maxCols = Math.max(1, Math.floor(MAX_INITIAL_RENDER_POINTS / rows));
      numericColumns.forEach((col, i) => {
        if (i >= maxCols) col.visible = false;
      });
      setColumnLimitNotice(
        `Showing ${maxCols} of ${cols} columns for performance. Toggle more in the column list.`
      );
    } else {
      setColumnLimitNotice(null);
    }

    setColumns(numericColumns);
    setColumnFilter('');
    setPcaVariance(null);
    // Color-by columns are dataset-specific; the mode itself is kept so e.g.
    // rainbow-by-file-order survives loading a new file.
    setCategoryColorColumn(prev => (prev && allStringCols.includes(prev) ? prev : null));
    // No string columns means category mode can't apply at all; drop back to
    // 'none' so the UI doesn't show a disabled "Category" option as selected.
    // (If other string columns exist, the mode is kept and the sub-select
    // prompts for a new column.)
    if (allStringCols.length === 0) {
      setColorMode(prev => (prev === 'category' ? 'none' : prev));
    }
    setRainbowOrderColumn(null);
    setPreSortColumns(null); // pre-sort order is dataset-specific
    setBrushSelection(null);
    setShowColumnGroups(false);
    setColumnGroups(new Map());

    // Clear isRecalculating if there are no numeric columns, since
    // ScatterPlotMatrix won't mount and onRenderComplete won't be called
    if (numericColumns.length === 0) {
      setIsRecalculating(false);
    }
  }, []);

  const handleDataLoaded = useCallback((csvText: string) => {
    // A new load supersedes any in-flight remote fetch or worker parse.
    const loadId = ++loadRequestIdRef.current;
    setIsUrlLoading(false);
    setUrlLoadError(null);
    // Show the indicator first; parsing happens in a Web Worker (PapaParse
    // worker: true) so the main thread stays free to paint the
    // "Recalculating…" pill and keep the UI responsive. PapaParse silently
    // falls back to synchronous parsing where Workers are unavailable
    // (e.g. jsdom tests), so defer to the next frame to let the pill paint
    // in that case too.
    setIsRecalculating(true);
    requestAnimationFrame(() => {
      // A newer load superseded this one before parsing even started.
      if (loadId !== loadRequestIdRef.current) return;
      Papa.parse<DataPoint>(csvText, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        worker: true,
        complete: (result) => {
          // Ignore stale worker completions from superseded loads so an
          // older, slower parse can't overwrite a newer dataset (or clear
          // the newer load's indicator).
          if (loadId !== loadRequestIdRef.current) return;
          applyParseResult(result);
        },
      });
    });
  }, [applyParseResult]);

  const loadSampleData = useCallback(() => {
    const requestId = ++loadRequestIdRef.current;
    const sampleDataUrl = `${import.meta.env.BASE_URL}data/sample.csv`;
    fetch(sampleDataUrl)
      .then(response => {
        if (!response.ok) throw new Error(`Failed to load sample data: ${response.statusText}`);
        return response.text();
      })
      .then(csvText => {
        // Ignore this response if a newer load started in the meantime
        if (loadRequestIdRef.current !== requestId) return;
        handleDataLoaded(csvText);
      })
      .catch(error => {
        console.error('Error loading sample data:', error);
      });
  }, [handleDataLoaded]);

  // File upload handler that also saves to history
  const handleFileUpload = useCallback(async (csvText: string, filename: string) => {
    handleDataLoaded(csvText);
    try {
      await saveFile(filename, csvText);
      const history = await getHistory();
      setRecentFiles(history);
    } catch (err) {
      console.warn('Could not save to history:', err);
    }
  }, [handleDataLoaded]);

  // Load CSV/TSV from a remote URL; successful loads are recorded in the
  // file history with the source URL as the name (issue #42).
  const handleLoadFromUrl = useCallback(async (url: string) => {
    const requestId = ++loadRequestIdRef.current;
    setUrlLoadError(null);
    setIsUrlLoading(true);
    setIsRecalculating(true);
    try {
      const csvText = await fetchCsvFromUrl(url);
      // Ignore this response if a newer load started in the meantime
      if (loadRequestIdRef.current !== requestId) return;
      await handleFileUpload(csvText, url);
    } catch (err) {
      // A newer load owns the loading/error state now; don't clobber it
      if (loadRequestIdRef.current !== requestId) return;
      setIsUrlLoading(false);
      setIsRecalculating(false);
      setUrlLoadError(err instanceof Error ? err.message : `Failed to load data from "${url}".`);
    }
  }, [handleFileUpload]);

  // On mount: honour a ?data=<url> query param, otherwise load the sample
  // data. The ref guard keeps React StrictMode's double-invoked effects (and
  // any dependency-identity churn) from kicking off a duplicate fetch.
  const didInitialLoadRef = useRef(false);
  useEffect(() => {
    if (didInitialLoadRef.current) return;
    didInitialLoadRef.current = true;
    const dataUrl = getDataUrlFromQuery(window.location.search);
    if (dataUrl) {
      handleLoadFromUrl(dataUrl);
    } else {
      loadSampleData();
    }
  }, [handleLoadFromUrl, loadSampleData]);

  const handleLoadFromHistory = useCallback((entry: FileHistoryEntry) => {
    handleDataLoaded(entry.csvText);
  }, [handleDataLoaded]);

  const handleDeleteFromHistory = useCallback(async (id: number) => {
    try {
      await deleteEntry(id);
      const history = await getHistory();
      setRecentFiles(history);
    } catch (err) {
      console.warn('Could not delete history entry:', err);
    }
  }, []);

  const handleColumnReorder = (dragIndex: number, hoverIndex: number) => {
    setColumns(prevColumns => reorderColumns(prevColumns, dragIndex, hoverIndex));
  };

  const handleColumnUpdate = (index: number, updatedColumn: Column) => {
    setColumns(prevColumns => {
      const newColumns = [...prevColumns];
      newColumns[index] = updatedColumn;
      return newColumns;
    });
  };

  const handleColumnGroupUpdate = (columnNames: string[], visible: boolean) => {
    setColumns(prev => prev.map(col =>
      columnNames.includes(col.name) ? { ...col, visible } : col
    ));
  };

  const handlePointHover = (content: string, event: MouseEvent) => {
    setTooltip({
      visible: true,
      content: content,
      x: event.pageX,
      y: event.pageY
    });
  };

  const handlePointLeave = () => {
    setTooltip(prev => ({ ...prev, visible: false }));
  };

  const handleColumnFilterChange = (filter: string) => {
    // B5: Only update the filter string; displayColumns is derived via useMemo
    setColumnFilter(filter);
  };

  const handleGlobalLogScaleToggle = (useLog: boolean) => {
    setGlobalLogScale(useLog);
    setColumns(prevColumns =>
      prevColumns.map(col => ({ ...col, scale: useLog ? 'log' : 'linear' as ScaleType }))
    );
  };

  const handleToggleColumnGroups = () => {
    if (!showColumnGroups) {
      // Compute groups on first enable
      const groups = detectColumnGroups(columns.map(c => c.name));
      setColumnGroups(groups);
    }
    setShowColumnGroups(prev => !prev);
  };

  // Issue #57: +/- zoom buttons and keyboard shortcuts step cellSize ~20%.
  // Wheel-gesture commits arrive through the same setCellSize, so the
  // ControlPanel slider stays in sync (cellSize is the single source of truth).
  const handleZoomStep = useCallback((direction: 1 | -1) => {
    setCellSize(prev => stepCellSize(prev, direction));
  }, []);

  const handleMatrixKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    // Don't hijack browser shortcuts (e.g. Ctrl/Cmd +/- page zoom) or Alt combos.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      handleZoomStep(1);
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      handleZoomStep(-1);
    }
  }, [handleZoomStep]);

  const handleRenderComplete = useCallback(() => {
    setIsRecalculating(false);
    setRenderProgress(null);
  }, []);

  const handleRenderProgress = useCallback((done: number, total: number) => {
    setRenderProgress(total > 0 ? { done, total } : null);
  }, []);

  // Issue #38: PCA over the currently visible numeric columns. PC1..PC3 are
  // appended as derived columns; clicking again recomputes and replaces them.
  // Uses displayColumns (same set the matrix renders) so an active column
  // filter also constrains which columns feed the PCA fit.
  const handleAddPCA = useCallback(() => {
    const pcNameSet = new Set<string>(PCA_COLUMN_NAMES);
    const inputColumnNames = displayColumns
      .filter(col => col.visible && !pcNameSet.has(col.name))
      .map(col => col.name);

    const result = computePCA(data, inputColumnNames);
    if (!result) {
      alert('PCA needs at least 2 visible numeric columns with variation and 2 complete rows.');
      return;
    }

    const numComponents = Math.min(PCA_COLUMN_NAMES.length, result.columnNames.length);
    const scores = projectPCA(data, result, numComponents);
    const pcNames = PCA_COLUMN_NAMES.slice(0, numComponents);

    setData(data.map((row, i) => {
      const next: DataPoint = { ...row };
      PCA_COLUMN_NAMES.forEach(name => { delete next[name]; }); // drop stale PCs
      pcNames.forEach((name, k) => { next[name] = scores[k][i]; });
      return next;
    }));
    setColumns(prev => [
      ...prev.filter(col => !pcNameSet.has(col.name)),
      ...pcNames.map(name => ({ name, scale: 'linear' as ScaleType, visible: true })),
    ]);
    setPcaVariance(pcNames.map((name, k) => ({
      name,
      ratio: result.explainedVarianceRatios[k],
    })));
  }, [data, displayColumns]);

  // Issue #39: precompute the per-row color state once per mode/column/data
  // change; the canvas paint loop only reads the resulting typed array.
  const colorState = useMemo(
    () => computeColorState(data, colorMode, categoryColorColumn, rainbowOrderColumn),
    [data, colorMode, categoryColorColumn, rainbowOrderColumn]
  );

  // Issue #36: sort columns by mean absolute correlation against the other
  // visible columns (descending). Visibility comes from displayColumns —
  // the set actually on screen, i.e. after the column filter — while the
  // reorder is applied to the base columns array through the same
  // setColumns path as drag-reorder. The first sort snapshots the current
  // order so "Restore column order" can undo it.
  const handleSortByCorrelation = useCallback(() => {
    const visibleNames = new Set<string>(
      displayColumns.filter(col => col.visible).map(col => col.name)
    );
    const sorted = sortColumnsByCorrelation(columns, data, correlationMetric, visibleNames);
    if (sorted === columns) return; // fewer than 2 visible columns
    // Order unchanged (already sorted): skip the state update — setColumns
    // would re-render the whole matrix — and don't arm a no-op "Restore
    // order". Element identity suffices: the sort reuses the Column objects.
    if (sorted.every((col, index) => col === columns[index])) return;
    setPreSortColumns(prev => prev ?? columns);
    setColumns(sorted);
  }, [columns, displayColumns, data, correlationMetric]);

  const handleRestoreColumnOrder = useCallback(() => {
    if (!preSortColumns) return;
    // Restore the ORDER only; visibility/scale edits made since survive.
    setColumns(prev => restoreColumnOrder(prev, preSortColumns));
    setPreSortColumns(null);
  }, [preSortColumns]);

  // Rainbow mode: clicking a diagonal column label orders the gradient by
  // that column's rank; clicking the active column again reverts to file order.
  const handleColumnLabelClick = useCallback((columnName: string) => {
    setRainbowOrderColumn(prev => (prev === columnName ? null : columnName));
  }, []);

  // Issue #56: the data table is available via a persistent toggle. When a
  // brush selection exists the table shows the selected rows (and still
  // auto-appears even with the toggle off, so the feature stays
  // discoverable); with the toggle on and no selection it shows the full
  // dataset capped at the first TABLE_ROW_CAP rows.
  const [showDataTable, setShowDataTable] = useState<boolean>(false);

  const hasActiveSelection = !!brushSelection?.selectedIds && brushSelection.selectedIds.size > 0;

  // Memoized so per-frame render-progress updates don't re-filter large datasets.
  const { tableRows, tableCapNote } = useMemo(() => {
    if (hasActiveSelection && brushSelection?.selectedIds) {
      return {
        tableRows: data.filter(row => brushSelection.selectedIds.has(row.__id)),
        tableCapNote: null as string | null,
      };
    }
    if (showDataTable) {
      const { rows, capNote } = capTableRows(data);
      return { tableRows: rows, tableCapNote: capNote };
    }
    return { tableRows: [], tableCapNote: null as string | null };
  }, [brushSelection, data, hasActiveSelection, showDataTable]);

  const tableVisible = isTableVisible(showDataTable, hasActiveSelection) && tableRows.length > 0;

  // B3 / issue #49: Resizable table panel.
  //
  // Drag mechanics: pointer events + setPointerCapture on the divider, so the
  // drag keeps tracking when the cursor leaves the 12px handle or the window
  // (the old mouse-event version lost the mouseup outside the window and got
  // stuck in drag mode). During the drag the height is written straight to
  // the panel's DOM style — no React state per move — so App (and the whole
  // scatter-plot matrix component tree) does not re-render on every
  // pointermove; the matrix container just shrinks and scrolls, its canvases
  // never repaint. State is committed once on pointerup. The height is
  // computed from the drag-start anchor + absolute pointer position (no
  // incremental deltas), and the anchor is the panel's *rendered* height, so
  // the panel can never jump at drag start even if state and layout disagree.
  const [tableHeight, setTableHeight] = useState(300);
  const tablePanelRef = useRef<HTMLDivElement>(null);
  const dividerDragRef = useRef<{
    pointerId: number;
    startY: number;
    startHeight: number;
    containerHeight: number;
  } | null>(null);

  const handleDividerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault(); // No text selection / native drag
    const panelHeight = tablePanelRef.current?.getBoundingClientRect().height ?? tableHeight;
    const mainElement = e.currentTarget.parentElement;
    dividerDragRef.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      startHeight: panelHeight,
      containerHeight: mainElement?.getBoundingClientRect().height ?? window.innerHeight,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'row-resize';
  };

  const handleDividerPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dividerDragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    const next = clampTableHeight(
      computeDragHeight(drag.startHeight, drag.startY, e.clientY),
      drag.containerHeight
    );
    if (tablePanelRef.current) {
      tablePanelRef.current.style.height = `${next}px`;
    }
  };

  const handleDividerPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dividerDragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    dividerDragRef.current = null;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    // Commit the final height to state (single React render for the drag).
    const finalHeight = tablePanelRef.current?.getBoundingClientRect().height;
    if (finalHeight) {
      setTableHeight(Math.round(finalHeight));
    }
  };

  // If the panel is hidden mid-drag (e.g. ESC clears the selection while the
  // toggle is off), the divider unmounts and its pointerup/pointercancel
  // never fire, which would leave the global drag styles (user-select /
  // cursor) stuck. Reset them whenever the panel goes away during a drag.
  useEffect(() => {
    if (!tableVisible && dividerDragRef.current) {
      dividerDragRef.current = null;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    }
  }, [tableVisible]);

  // Global loading indicator — visible in both empty and main views
  const loadingPill = isRecalculating && (
    <div className="fixed top-4 right-4 z-50 px-4 py-2 bg-brand-primary text-white text-sm font-semibold rounded-full shadow-lg animate-pulse pointer-events-none">
      Recalculating…{renderProgress ? ` ${renderProgress.done}/${renderProgress.total} cells` : ''}
    </div>
  );

  // URL load error banner — visible in both empty and main views
  const urlErrorBanner = urlLoadError && (
    <div role="alert" className="mx-4 mt-2 px-4 py-2 bg-red-50 border border-red-300 rounded-lg flex items-center justify-between text-sm text-red-800">
      <span>{urlLoadError}</span>
      <button
        onClick={() => setUrlLoadError(null)}
        className="ml-3 text-red-600 hover:text-red-800 font-bold"
        aria-label="Dismiss error"
      >
        ✕
      </button>
    </div>
  );

  if (!columns.length) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 text-gray-700">
        {loadingPill}
        <div className="max-w-xl text-center p-8 bg-white rounded-lg shadow-md">
          <h1 className="text-3xl font-bold text-brand-primary mb-1">Interactive Scatter Plot Matrix</h1>
          <p className="text-xs text-gray-400 font-mono mb-4" title="build version">{__APP_VERSION__}</p>
          <p className="mb-6">Upload a CSV or TSV file to begin visualizing your data, or load the sample dataset to explore the tool's features.</p>
          <div className="flex justify-center space-x-4">
            <FileUpload onDataLoaded={handleFileUpload} />
            <button
              onClick={loadSampleData}
              className="px-4 py-2 bg-brand-secondary text-white font-semibold rounded-lg shadow-md hover:bg-brand-primary transition-colors"
            >
              Load Sample Data
            </button>
          </div>
          <div className="mt-4 text-left">
            <p className="text-sm font-medium text-gray-600 mb-1">Or load a CSV/TSV from a URL:</p>
            <UrlInput onLoadUrl={handleLoadFromUrl} isLoading={isUrlLoading} />
          </div>
          {urlErrorBanner}
        </div>
      </div>
    );
  }

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="flex flex-col h-screen font-sans">
        {loadingPill}
        <Tooltip content={tooltip.content} x={tooltip.x} y={tooltip.y} visible={tooltip.visible} />
        <header className="bg-brand-dark text-white p-4 shadow-md flex justify-between items-center">
          <div className="flex items-baseline space-x-3">
            <h1 className="text-2xl font-bold">Interactive Scatter Plot Matrix</h1>
            <span className="text-xs text-gray-300 font-mono" title="build version">{__APP_VERSION__}</span>
          </div>
          <div className="flex items-center space-x-4">
            {brushSelection && (
              <button
                onClick={() => setBrushSelection(null)}
                className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded"
                title="Clear selection (Esc)"
              >
                ✕ Clear
              </button>
            )}
            <a href="https://github.com/dbolser/Demonstrable-Plotalizer" target="_blank" rel="noopener noreferrer" className="text-white hover:text-brand-secondary">
              <GitHubIcon className="h-8 w-8" />
            </a>
          </div>
        </header>
        <div className="flex flex-1 overflow-hidden">
          <aside className="w-64 bg-white p-4 overflow-y-auto shadow-lg">
            <ControlPanel
              columns={columns}
              visibleDisplayCount={visibleDisplayCount}
              onColumnUpdate={handleColumnUpdate}
              onDataLoaded={handleFileUpload}
              onLoadFromUrl={handleLoadFromUrl}
              isUrlLoading={isUrlLoading}
              filterMode={filterMode}
              setFilterMode={setFilterMode}
              showHistograms={showHistograms}
              setShowHistograms={setShowHistograms}
              showDataTable={showDataTable}
              setShowDataTable={setShowDataTable}
              useUniformLogBins={useUniformLogBins}
              setUseUniformLogBins={setUseUniformLogBins}
              globalLogScale={globalLogScale}
              onToggleGlobalLogScale={handleGlobalLogScaleToggle}
              showIdentityLine={showIdentityLine}
              setShowIdentityLine={setShowIdentityLine}
              showRegressionLine={showRegressionLine}
              setShowRegressionLine={setShowRegressionLine}
              showCorrelation={showCorrelation}
              setShowCorrelation={setShowCorrelation}
              tintCellBorders={tintCellBorders}
              setTintCellBorders={setTintCellBorders}
              correlationMetric={correlationMetric}
              setCorrelationMetric={setCorrelationMetric}
              onSortByCorrelation={handleSortByCorrelation}
              canRestoreColumnOrder={preSortColumns !== null}
              onRestoreColumnOrder={handleRestoreColumnOrder}
              stringColumns={stringColumns}
              columnFilter={columnFilter}
              onColumnFilterChange={handleColumnFilterChange}
              cellSize={cellSize}
              onCellSizeChange={setCellSize}
              showColumnGroups={showColumnGroups}
              columnGroups={columnGroups}
              onToggleColumnGroups={handleToggleColumnGroups}
              onColumnGroupUpdate={handleColumnGroupUpdate}
              recentFiles={recentFiles}
              onLoadFromHistory={handleLoadFromHistory}
              onDeleteFromHistory={handleDeleteFromHistory}
              onAddPCA={handleAddPCA}
              pcaVariance={pcaVariance}
              colorMode={colorMode}
              setColorMode={setColorMode}
              categoryColorColumn={categoryColorColumn}
              setCategoryColorColumn={setCategoryColorColumn}
              rainbowOrderColumn={rainbowOrderColumn}
              onResetRainbowOrder={() => setRainbowOrderColumn(null)}
              colorState={colorState}
            />
          </aside>
          <main className="flex-1 flex flex-col bg-gray-100 overflow-hidden">
            {/* Notices */}
            {urlErrorBanner}
            {columnLimitNotice && (
              <div className="mx-4 mt-2 px-4 py-2 bg-yellow-50 border border-yellow-300 rounded-lg flex items-center justify-between text-sm text-yellow-800">
                <span>{columnLimitNotice}</span>
                <button
                  onClick={() => setColumnLimitNotice(null)}
                  className="ml-3 text-yellow-600 hover:text-yellow-800 font-bold"
                >
                  ✕
                </button>
              </div>
            )}

            <div
              className="p-4 overflow-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-primary"
              style={{
                flex: tableVisible ? '1 1 auto' : '1 1 0',
                minHeight: 0
              }}
              tabIndex={0}
              onKeyDown={handleMatrixKeyDown}
            >
              {/* Issue #57: zoom controls — sticky so they stay visible while
                  the (potentially huge) matrix scrolls beneath them. */}
              <div className="sticky top-0 left-0 z-20 mb-2 flex w-fit items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleZoomStep(-1)}
                  aria-label="Zoom out"
                  title="Zoom out (-)  ·  Ctrl+scroll to zoom"
                  className="w-7 h-7 flex items-center justify-center rounded border border-gray-300 bg-white/90 text-gray-700 shadow-sm hover:bg-gray-200 font-bold leading-none select-none"
                >
                  −
                </button>
                <button
                  type="button"
                  onClick={() => handleZoomStep(1)}
                  aria-label="Zoom in"
                  title="Zoom in (+)  ·  Ctrl+scroll to zoom"
                  className="w-7 h-7 flex items-center justify-center rounded border border-gray-300 bg-white/90 text-gray-700 shadow-sm hover:bg-gray-200 font-bold leading-none select-none"
                >
                  +
                </button>
              </div>
              <ScatterPlotMatrix
                data={data}
                columns={displayColumns}
                onColumnReorder={handleColumnReorder}
                brushSelection={brushSelection}
                onBrush={setBrushSelection}
                filterMode={filterMode}
                showHistograms={showHistograms}
                useUniformLogBins={useUniformLogBins}
                labelColumn={labelColumn}
                onPointHover={handlePointHover}
                onPointLeave={handlePointLeave}
                cellSize={cellSize}
                onCellSizeChange={setCellSize}
                onRenderComplete={handleRenderComplete}
                onRenderProgress={handleRenderProgress}
                colorState={colorState}
                rainbowOrderColumn={rainbowOrderColumn}
                onColumnLabelClick={handleColumnLabelClick}
                showIdentityLine={showIdentityLine}
                showRegressionLine={showRegressionLine}
                showCorrelation={showCorrelation}
                correlationMetric={correlationMetric}
                tintCellBorders={tintCellBorders}
              />
            </div>
            {tableVisible && (
              <>
                <div
                  className="h-3 bg-gray-300 hover:bg-brand-primary cursor-row-resize flex items-center justify-center transition-colors flex-shrink-0"
                  style={{ touchAction: 'none' }}
                  onPointerDown={handleDividerPointerDown}
                  onPointerMove={handleDividerPointerMove}
                  onPointerUp={handleDividerPointerEnd}
                  onPointerCancel={handleDividerPointerEnd}
                  title="Drag to resize table"
                >
                  <div className="w-12 h-1 bg-gray-500 rounded"></div>
                </div>
                <div
                  ref={tablePanelRef}
                  style={{ height: `${tableHeight}px` }}
                  className="overflow-hidden flex-shrink-0"
                >
                  <DataTable
                    data={tableRows}
                    columns={displayColumns}
                    stringColumns={stringColumns}
                    heading={hasActiveSelection ? 'Selected Data' : 'All Data'}
                    capNote={tableCapNote}
                  />
                </div>
              </>
            )}
          </main>
        </div>
      </div>
    </DndProvider>
  );
};

export default App;
