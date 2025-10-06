import React, { useState, useEffect, useCallback } from 'react';
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

const getTimestamp = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const App: React.FC = () => {
  const [data, setData] = useState<DataPoint[]>([]);
  const [columns, setColumns] = useState<Column[]>([]);
  const [labelColumn, setLabelColumn] = useState<string | null>(null);
  const [brushSelection, setBrushSelection] = useState<BrushSelection | null>(null);
  const [filterMode, setFilterMode] = useState<FilterMode>('highlight');
  const [showHistograms, setShowHistograms] = useState<boolean>(true);
  const [useUniformLogBins, setUseUniformLogBins] = useState<boolean>(false);
  const [globalLogScale, setGlobalLogScale] = useState<boolean>(false);
  const [columnFilter, setColumnFilter] = useState<string>('');
  const [tooltip, setTooltip] = useState<{ visible: boolean; content: string; x: number; y: number }>({
    visible: false,
    content: '',
    x: 0,
    y: 0,
  });
  const [loadingPhase, setLoadingPhase] = useState<'idle' | 'loading-data' | 'rendering'>('idle');
  const [loadingStartTime, setLoadingStartTime] = useState<number | null>(null);
  const [timeNow, setTimeNow] = useState<number>(() => getTimestamp());
  const [renderProgress, setRenderProgress] = useState<{ completed: number; total: number }>({ completed: 0, total: 0 });

  const startLoadingData = useCallback(() => {
    setLoadingPhase('loading-data');
    setLoadingStartTime(getTimestamp());
    setRenderProgress({ completed: 0, total: 0 });
  }, []);

  const loadSampleData = useCallback(() => {
    startLoadingData();
    fetch('/data/sample.csv')
      .then(response => response.text())
      .then(csvText => {
        handleDataLoaded(csvText);
      });
  }, [startLoadingData]);

  useEffect(() => {
    loadSampleData();
     // eslint-disable-next-line react-hooks/exhaustive-deps
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

  useEffect(() => {
    if (loadingPhase === 'idle' || typeof window === 'undefined') {
      return;
    }
    setTimeNow(getTimestamp());
    const interval = window.setInterval(() => {
      setTimeNow(getTimestamp());
    }, 100);
    return () => {
      window.clearInterval(interval);
    };
  }, [loadingPhase]);

  const handleDataLoaded = (csvText: string) => {
    if (loadingPhase !== 'loading-data') {
      startLoadingData();
    }
    const result = Papa.parse<DataPoint>(csvText, { header: true, dynamicTyping: true, skipEmptyLines: true });
    if (result.errors.length > 0) {
      console.error("CSV Parsing errors:", result.errors);
      alert("Error parsing CSV file. Check console for details.");
      setLoadingPhase('idle');
      setLoadingStartTime(null);
      return;
    }

    const rawData = result.data;
    if (rawData.length === 0) {
      setData([]);
      setColumns([]);
      setLabelColumn(null);
      setLoadingPhase('idle');
      setLoadingStartTime(null);
      return;
    }
    
    // Add a unique ID to each data point
    const dataWithIds = rawData.map((d, i) => ({ ...d, __id: i }));
    setData(dataWithIds);

    // Auto-detect the first string column as the label
    const firstStringCol = result.meta.fields?.find(field => typeof rawData[0][field] === 'string');
    setLabelColumn(firstStringCol || null);

    const numericColumns = Object.keys(dataWithIds[0])
      .filter(key => typeof dataWithIds[0][key] === 'number' && key !== '__id')
      .map(key => ({
        name: key,
        scale: 'linear' as ScaleType,
        visible: true,
      }));
    setColumns(numericColumns);
    setBrushSelection(null);
    if (numericColumns.length === 0) {
      setLoadingPhase('idle');
      setLoadingStartTime(null);
    }
  };

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
    setColumnFilter(filter);
    setColumns(prevColumns => filterColumns(prevColumns, filter));
  };

  const handleGlobalLogScaleToggle = (useLog: boolean) => {
    setGlobalLogScale(useLog);
    setColumns(prevColumns =>
      prevColumns.map(col => ({ ...col, scale: useLog ? 'log' : 'linear' as ScaleType }))
    );
  };

  const handleRenderStart = useCallback((totalPlots: number) => {
    setLoadingPhase('rendering');
    setLoadingStartTime(getTimestamp());
    setRenderProgress({ completed: 0, total: totalPlots });
  }, []);

  const handleRenderProgress = useCallback((completed: number, totalPlots: number) => {
    setRenderProgress({ completed, total: totalPlots });
  }, []);

  const handleRenderComplete = useCallback(() => {
    setRenderProgress(prev => ({ completed: prev.total, total: prev.total }));
    setLoadingPhase('idle');
    setLoadingStartTime(null);
  }, []);

  // Compute data to show in the table (only selected points if there's a selection)
  const tableData = brushSelection?.selectedIds 
    ? data.filter(row => brushSelection.selectedIds.has(row.__id))
    : [];

  // Resizable table panel
  const [tableHeight, setTableHeight] = useState(300); // pixels
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const mainElement = document.querySelector('main');
      if (!mainElement) return;

      const mainRect = mainElement.getBoundingClientRect();
      const newHeight = mainRect.bottom - e.clientY;
      // Clamp between 100px and 80% of main height
      const maxHeight = mainRect.height * 0.8;
      setTableHeight(Math.max(100, Math.min(maxHeight, newHeight)));
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  const elapsedSeconds = loadingStartTime != null ? Math.max(0, (timeNow - loadingStartTime) / 1000) : 0;
  const loadingOverlay = loadingPhase !== 'idle' ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/80 backdrop-blur-sm">
      <div className="bg-white rounded-lg shadow-xl p-6 w-80 text-center space-y-4 border border-brand-secondary/30">
        <div className="text-lg font-semibold text-brand-dark">
          {loadingPhase === 'loading-data' ? 'Loading data…' : 'Rendering scatter plots…'}
        </div>
        <div className="text-sm text-gray-600">Elapsed time: {elapsedSeconds.toFixed(1)}s</div>
        {loadingPhase === 'rendering' && renderProgress.total > 0 && (
          <div className="space-y-2">
            <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
              <div
                className="h-2 bg-brand-secondary transition-all duration-150 ease-out"
                style={{ width: `${Math.min(100, (renderProgress.completed / renderProgress.total) * 100)}%` }}
              />
            </div>
            <div className="text-xs text-gray-500">
              {renderProgress.completed} / {renderProgress.total} scatter tiles
            </div>
          </div>
        )}
      </div>
    </div>
  ) : null;

  if (!columns.length) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 text-gray-700">
        {loadingOverlay}
        <div className="max-w-xl text-center p-8 bg-white rounded-lg shadow-md">
          <h1 className="text-3xl font-bold text-brand-primary mb-4">Interactive Scatter Plot Matrix</h1>
          <p className="mb-6">Upload a CSV file to begin visualizing your data, or load the sample dataset to explore the tool's features.</p>
          <div className="flex justify-center space-x-4">
            <FileUpload onDataLoaded={handleDataLoaded} />
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
        {loadingOverlay}
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
              onColumnUpdate={handleColumnUpdate}
              onDataLoaded={handleDataLoaded}
              filterMode={filterMode}
              setFilterMode={setFilterMode}
              showHistograms={showHistograms}
              setShowHistograms={setShowHistograms}
              useUniformLogBins={useUniformLogBins}
              setUseUniformLogBins={setUseUniformLogBins}
              globalLogScale={globalLogScale}
              onToggleGlobalLogScale={handleGlobalLogScaleToggle}
              labelColumn={labelColumn}
              columnFilter={columnFilter}
              onColumnFilterChange={handleColumnFilterChange}
            />
          </aside>
          <main className="flex-1 flex flex-col bg-gray-100 overflow-hidden">
            <div
              className="p-4 overflow-auto"
              style={{
                flex: tableData.length > 0 ? '1 1 auto' : '1 1 0',
                minHeight: 0
              }}
            >
              <ScatterPlotMatrix
                data={data}
                columns={columns}
                onColumnReorder={handleColumnReorder}
                brushSelection={brushSelection}
                onBrush={setBrushSelection}
                filterMode={filterMode}
                showHistograms={showHistograms}
                useUniformLogBins={useUniformLogBins}
                labelColumn={labelColumn}
                onPointHover={handlePointHover}
                onPointLeave={handlePointLeave}
                onRenderStart={handleRenderStart}
                onRenderProgress={handleRenderProgress}
                onRenderComplete={handleRenderComplete}
              />
            </div>
            {tableData.length > 0 && (
              <>
                <div
                  className="h-2 bg-gray-300 hover:bg-brand-primary cursor-row-resize flex items-center justify-center transition-colors"
                  onMouseDown={() => setIsDragging(true)}
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
                    columns={columns}
                    labelColumn={labelColumn}
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