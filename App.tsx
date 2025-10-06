import React, { useState, useEffect, useCallback, useTransition } from 'react';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import Papa from 'papaparse';
import { FileUpload } from './components/FileUpload';
import { ControlPanel } from './components/ControlPanel';
import { ScatterPlotMatrix } from './components/ScatterPlotMatrix';
import { Tooltip } from './components/Tooltip';
import { DataTable } from './components/DataTable';
import { LoadingOverlay } from './components/LoadingOverlay';
import type { DataPoint, Column, ScaleType, BrushSelection, FilterMode } from './types';
import { GitHubIcon } from './components/icons';
import { reorderColumns, filterColumns } from './src/utils/columnUtils';

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
  const [loadingPhase, setLoadingPhase] = useState<'idle' | 'loadingData'>('idle');
  const [loadingElapsed, setLoadingElapsed] = useState(0);
  const [renderProgress, setRenderProgress] = useState<{ active: boolean; total: number; completed: number }>({
    active: false,
    total: 0,
    completed: 0,
  });
  const [renderElapsed, setRenderElapsed] = useState(0);
  const [, startFilterTransition] = useTransition();

  const loadSampleData = useCallback(() => {
    setLoadingPhase('loadingData');
    fetch('/data/sample.csv')
      .then(response => response.text())
      .then(csvText => {
        handleDataLoaded(csvText);
      })
      .catch(error => {
        console.error('Failed to load sample data', error);
        setLoadingPhase('idle');
      });
  }, []);

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

  const handleDataLoaded = (csvText: string) => {
    setLoadingPhase('loadingData');
    setRenderProgress({ active: false, total: 0, completed: 0 });

    Papa.parse<DataPoint>(csvText, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      worker: true,
      complete: (result) => {
        if (result.errors.length > 0) {
          console.error('CSV Parsing errors:', result.errors);
          alert('Error parsing CSV file. Check console for details.');
          setLoadingPhase('idle');
          return;
        }

        const rawData = result.data;
        if (rawData.length === 0) {
          setData([]);
          setColumns([]);
          setLabelColumn(null);
          setLoadingPhase('idle');
          return;
        }

        const dataWithIds = rawData.map((d, i) => ({ ...d, __id: i }));
        setData(dataWithIds);

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
        setLoadingPhase('idle');
      },
      error: (error) => {
        console.error('CSV Parsing error:', error);
        alert('Error parsing CSV file. Check console for details.');
        setLoadingPhase('idle');
      },
    });
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
    startFilterTransition(() => {
      setColumns(prevColumns => filterColumns(prevColumns, filter));
    });
  };

  const handleGlobalLogScaleToggle = (useLog: boolean) => {
    setGlobalLogScale(useLog);
    setColumns(prevColumns =>
      prevColumns.map(col => ({ ...col, scale: useLog ? 'log' : 'linear' as ScaleType }))
    );
  };

  // Compute data to show in the table (only selected points if there's a selection)
  const tableData = brushSelection?.selectedIds
    ? data.filter(row => brushSelection.selectedIds.has(row.__id))
    : [];

  useEffect(() => {
    if (loadingPhase !== 'loadingData') {
      setLoadingElapsed(0);
      return;
    }

    const start = performance.now();
    setLoadingElapsed(0);
    const interval = window.setInterval(() => {
      setLoadingElapsed(performance.now() - start);
    }, 100);
    return () => window.clearInterval(interval);
  }, [loadingPhase]);

  useEffect(() => {
    if (!renderProgress.active) {
      setRenderElapsed(0);
      return;
    }

    const start = performance.now();
    setRenderElapsed(0);
    const interval = window.setInterval(() => {
      setRenderElapsed(performance.now() - start);
    }, 100);
    return () => window.clearInterval(interval);
  }, [renderProgress.active]);

  const handleRenderLifecycle = useCallback((event: { phase: 'rendering' | 'idle'; total: number; completed: number }) => {
    setRenderProgress(prev => {
      if (event.phase === 'rendering' && event.total > 0) {
        return {
          active: true,
          total: event.total,
          completed: Math.min(event.completed, event.total),
        };
      }

      if (event.phase === 'idle') {
        return {
          active: false,
          total: event.total,
          completed: Math.min(event.completed, event.total),
        };
      }

      return prev;
    });
  }, []);

  const overlay = (() => {
    if (loadingPhase === 'loadingData') {
      return (
        <LoadingOverlay
          message="Loading data"
          detail={`Elapsed time: ${(loadingElapsed / 1000).toFixed(1)}s`}
        />
      );
    }

    if (renderProgress.active && renderProgress.total > 0) {
      const progress = renderProgress.completed / renderProgress.total;
      return (
        <LoadingOverlay
          message="Rendering scatter plots"
          detail={`Rendered ${renderProgress.completed} of ${renderProgress.total} • ${(renderElapsed / 1000).toFixed(1)}s elapsed`}
          progress={progress}
        />
      );
    }

    return null;
  })();

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

  if (!columns.length) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 text-gray-700">
        {overlay}
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
        {overlay}
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
                onRenderLifecycle={handleRenderLifecycle}
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