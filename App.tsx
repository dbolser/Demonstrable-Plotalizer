import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import Papa from 'papaparse';
import { FileUpload } from './components/FileUpload';
import { ControlPanel } from './components/ControlPanel';
import { ScatterPlotMatrix } from './components/ScatterPlotMatrix';
import { Tooltip } from './components/Tooltip';
import { DataTable } from './components/DataTable';
import type { DataPoint, Column, ScaleType, BrushSelection, FilterMode } from './types';
import { GitHubIcon } from './components/icons';
import { reorderColumns, filterColumns } from './src/utils/columnUtils';
import { detectColumnGroups } from './src/utils/groupUtils';
import { saveFile, getHistory, deleteEntry } from './src/utils/fileHistory';
import type { FileHistoryEntry } from './src/utils/fileHistory';

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
  const [columnFilter, setColumnFilter] = useState<string>('');
  const [isRecalculating, setIsRecalculating] = useState<boolean>(false);
  const [columnLimitNotice, setColumnLimitNotice] = useState<string | null>(null);
  const [cellSize, setCellSize] = useState<number>(150);
  const [showColumnGroups, setShowColumnGroups] = useState<boolean>(false);
  const [columnGroups, setColumnGroups] = useState<Map<string, string[]>>(new Map());
  const [recentFiles, setRecentFiles] = useState<FileHistoryEntry[]>([]);

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
    getHistory().then(setRecentFiles).catch(() => {});
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

  // Parse CSV and apply data — separated from handleDataLoaded so the loading
  // indicator can paint before the heavy state updates trigger D3 work.
  const applyParsedData = useCallback((csvText: string) => {
    const result = Papa.parse<DataPoint>(csvText, { header: true, dynamicTyping: true, skipEmptyLines: true });
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

    // B4: Detect ALL string columns
    const allStringCols = (result.meta.fields || []).filter(
      field => typeof rawData[0][field] === 'string'
    );
    setStringColumns(allStringCols);
    setLabelColumn(allStringCols[0] || null);

    const numericColumns = Object.keys(dataWithIds[0])
      .filter(key => typeof dataWithIds[0][key] === 'number' && key !== '__id')
      .map(key => ({
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
    setBrushSelection(null);
    setShowColumnGroups(false);
    setColumnGroups(new Map());
  }, []);

  const handleDataLoaded = useCallback((csvText: string) => {
    // Show the indicator first, then defer heavy work to next frame so the
    // browser can actually paint the "Recalculating…" pill before D3 blocks.
    setIsRecalculating(true);
    requestAnimationFrame(() => {
      applyParsedData(csvText);
    });
  }, [applyParsedData]);

  const loadSampleData = useCallback(() => {
    const sampleDataUrl = `${import.meta.env.BASE_URL}data/sample.csv`;
    fetch(sampleDataUrl)
      .then(response => {
        if (!response.ok) throw new Error(`Failed to load sample data: ${response.statusText}`);
        return response.text();
      })
      .then(csvText => {
        handleDataLoaded(csvText);
      })
      .catch(error => {
        console.error('Error loading sample data:', error);
      });
  }, [handleDataLoaded]);

  useEffect(() => {
    loadSampleData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const handleRenderComplete = useCallback(() => {
    setIsRecalculating(false);
  }, []);

  // Compute data to show in the table (only selected points if there's a selection)
  const tableData = brushSelection?.selectedIds
    ? data.filter(row => brushSelection.selectedIds.has(row.__id))
    : [];

  // B3: Resizable table panel — fixed drag logic
  const [tableHeight, setTableHeight] = useState(300);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ startY: number; startHeight: number } | null>(null);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;
      const { startY, startHeight } = dragStartRef.current;
      const newHeight = startHeight + (startY - e.clientY);
      const mainElement = document.querySelector('main');
      const maxHeight = mainElement ? mainElement.getBoundingClientRect().height * 0.8 : 600;
      setTableHeight(Math.max(100, Math.min(maxHeight, newHeight)));
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.body.style.userSelect = '';
      dragStartRef.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  const handleDragHandleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault(); // Prevent browser default drag behaviour
    dragStartRef.current = { startY: e.clientY, startHeight: tableHeight };
    setIsDragging(true);
    document.body.style.userSelect = 'none';
  };

  // Global loading indicator — visible in both empty and main views
  const loadingPill = isRecalculating && (
    <div className="fixed top-4 right-4 z-50 px-4 py-2 bg-brand-primary text-white text-sm font-semibold rounded-full shadow-lg animate-pulse pointer-events-none">
      Recalculating…
    </div>
  );

  if (!columns.length) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 text-gray-700">
        {loadingPill}
        <div className="max-w-xl text-center p-8 bg-white rounded-lg shadow-md">
          <h1 className="text-3xl font-bold text-brand-primary mb-4">Interactive Scatter Plot Matrix</h1>
          <p className="mb-6">Upload a CSV file to begin visualizing your data, or load the sample dataset to explore the tool's features.</p>
          <div className="flex justify-center space-x-4">
            <FileUpload onDataLoaded={handleFileUpload} />
            <button
              onClick={loadSampleData}
              className="px-4 py-2 bg-brand-secondary text-white font-semibold rounded-lg shadow-md hover:bg-brand-primary transition-colors"
            >
              Load Sample Data
            </button>
          </div>
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
          <h1 className="text-2xl font-bold">Interactive Scatter Plot Matrix</h1>
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
              filterMode={filterMode}
              setFilterMode={setFilterMode}
              showHistograms={showHistograms}
              setShowHistograms={setShowHistograms}
              useUniformLogBins={useUniformLogBins}
              setUseUniformLogBins={setUseUniformLogBins}
              globalLogScale={globalLogScale}
              onToggleGlobalLogScale={handleGlobalLogScaleToggle}
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
            />
          </aside>
          <main className="flex-1 flex flex-col bg-gray-100 overflow-hidden">
            {/* Notices */}
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
              className="p-4 overflow-auto"
              style={{
                flex: tableData.length > 0 ? '1 1 auto' : '1 1 0',
                minHeight: 0
              }}
            >
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
                onRenderComplete={handleRenderComplete}
              />
            </div>
            {tableData.length > 0 && (
              <>
                <div
                  className="h-3 bg-gray-300 hover:bg-brand-primary cursor-row-resize flex items-center justify-center transition-colors flex-shrink-0"
                  onMouseDown={handleDragHandleMouseDown}
                  title="Drag to resize table"
                >
                  <div className="w-12 h-1 bg-gray-500 rounded"></div>
                </div>
                <div
                  style={{ height: `${tableHeight}px`, minHeight: '100px', maxHeight: '80%' }}
                  className="overflow-hidden"
                >
                  <DataTable
                    data={tableData}
                    columns={displayColumns}
                    stringColumns={stringColumns}
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
