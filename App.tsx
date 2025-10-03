import React, { useState, useEffect, useCallback } from 'react';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import Papa from 'papaparse';
import { FileUpload } from './components/FileUpload';
import { ControlPanel } from './components/ControlPanel';
import { ScatterPlotMatrix } from './components/ScatterPlotMatrix';
import { Tooltip } from './components/Tooltip';
import type { DataPoint, Column, ScaleType, BrushSelection, FilterMode } from './types';
import { GithubIcon } from './components/icons';

const App: React.FC = () => {
  const [data, setData] = useState<DataPoint[]>([]);
  const [columns, setColumns] = useState<Column[]>([]);
  const [labelColumn, setLabelColumn] = useState<string | null>(null);
  const [brushSelection, setBrushSelection] = useState<BrushSelection | null>(null);
  const [filterMode, setFilterMode] = useState<FilterMode>('highlight');
  const [showHistograms, setShowHistograms] = useState<boolean>(true);
  const [columnFilter, setColumnFilter] = useState<string>('');
  const [tooltip, setTooltip] = useState<{ visible: boolean; content: string; x: number; y: number }>({
    visible: false,
    content: '',
    x: 0,
    y: 0,
  });

  const loadSampleData = useCallback(() => {
    fetch('/data/sample.csv')
      .then(response => response.text())
      .then(csvText => {
        handleDataLoaded(csvText);
      });
  }, []);

  useEffect(() => {
    loadSampleData();
     // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDataLoaded = (csvText: string) => {
    const result = Papa.parse<DataPoint>(csvText, { header: true, dynamicTyping: true, skipEmptyLines: true });
    if (result.errors.length > 0) {
      console.error("CSV Parsing errors:", result.errors);
      alert("Error parsing CSV file. Check console for details.");
      return;
    }

    const rawData = result.data;
    if (rawData.length === 0) {
      setData([]);
      setColumns([]);
      setLabelColumn(null);
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
  };

  const handleColumnReorder = (dragIndex: number, hoverIndex: number) => {
    setColumns(prevColumns => {
      const newColumns = [...prevColumns];
      // Perform a direct swap
      [newColumns[dragIndex], newColumns[hoverIndex]] = [newColumns[hoverIndex], newColumns[dragIndex]];
      return newColumns;
    });
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

    // Update column visibility based on filter
    setColumns(prevColumns => {
      return prevColumns.map(col => ({
        ...col,
        visible: filter === '' || col.name.toLowerCase().includes(filter.toLowerCase())
      }));
    });
  };

  if (!columns.length) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 text-gray-700">
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
        <Tooltip content={tooltip.content} x={tooltip.x} y={tooltip.y} visible={tooltip.visible} />
        <header className="bg-brand-dark text-white p-4 shadow-md flex justify-between items-center">
          <h1 className="text-2xl font-bold">Interactive Scatter Plot Matrix</h1>
           <a href="https://github.com/your-repo" target="_blank" rel="noopener noreferrer" className="text-white hover:text-brand-secondary">
             <GithubIcon className="h-8 w-8" />
           </a>
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
              labelColumn={labelColumn}
              columnFilter={columnFilter}
              onColumnFilterChange={handleColumnFilterChange}
            />
          </aside>
          <main className="flex-1 p-4 bg-gray-100 overflow-auto">
            <ScatterPlotMatrix
              data={data}
              columns={columns}
              onColumnReorder={handleColumnReorder}
              brushSelection={brushSelection}
              onBrush={setBrushSelection}
              filterMode={filterMode}
              showHistograms={showHistograms}
              labelColumn={labelColumn}
              onPointHover={handlePointHover}
              onPointLeave={handlePointLeave}
            />
          </main>
        </div>
      </div>
    </DndProvider>
  );
};

export default App;