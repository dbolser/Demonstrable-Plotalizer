import React from 'react';
import type { Column, FilterMode } from '../types';
import { FileUpload } from './FileUpload';
import { DownloadIcon } from './icons';
import type { FileHistoryEntry } from '../src/utils/fileHistory';
import { formatRelativeTime } from '../src/utils/fileHistory';

interface ControlPanelProps {
  columns: Column[];
  visibleDisplayCount: number;
  onColumnUpdate: (index: number, updatedColumn: Column) => void;
  onDataLoaded: (data: string, filename: string) => void;
  filterMode: FilterMode;
  setFilterMode: (mode: FilterMode) => void;
  showHistograms: boolean;
  setShowHistograms: (show: boolean) => void;
  useUniformLogBins: boolean;
  setUseUniformLogBins: (useUniform: boolean) => void;
  globalLogScale: boolean;
  onToggleGlobalLogScale: (useLog: boolean) => void;
  stringColumns: string[];
  columnFilter: string;
  onColumnFilterChange: (filter: string) => void;
  cellSize: number;
  onCellSizeChange: (size: number) => void;
  showColumnGroups: boolean;
  columnGroups: Map<string, string[]>;
  onToggleColumnGroups: () => void;
  onColumnGroupUpdate: (columnNames: string[], visible: boolean) => void;
  recentFiles: FileHistoryEntry[];
  onLoadFromHistory: (entry: FileHistoryEntry) => void;
  onDeleteFromHistory: (id: number) => void;
}

export const ControlPanel: React.FC<ControlPanelProps> = ({
  columns,
  visibleDisplayCount,
  onColumnUpdate,
  onDataLoaded,
  filterMode,
  setFilterMode,
  showHistograms,
  setShowHistograms,
  useUniformLogBins,
  setUseUniformLogBins,
  globalLogScale,
  onToggleGlobalLogScale,
  stringColumns,
  columnFilter,
  onColumnFilterChange,
  cellSize,
  onCellSizeChange,
  showColumnGroups,
  columnGroups,
  onToggleColumnGroups,
  onColumnGroupUpdate,
  recentFiles,
  onLoadFromHistory,
  onDeleteFromHistory,
}) => {

  const handleDownloadSVG = () => {
    const svgElement = document.querySelector('#scatterplot-matrix-svg');
    if (!svgElement) {
      alert('Could not find the SVG element to download.');
      return;
    }

    const serializer = new XMLSerializer();
    let source = serializer.serializeToString(svgElement);
    source = '<?xml version="1.0" standalone="no"?>\r\n' + source;

    const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(source);

    const downloadLink = document.createElement("a");
    downloadLink.href = url;
    downloadLink.download = "scatter-plot-matrix.svg";
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
  };

  // Build grouped column list for rendering
  const renderColumnList = () => {
    if (showColumnGroups && columnGroups.size > 0) {
      const grouped = new Set<string>();
      const sections: React.ReactNode[] = [];

      for (const [groupName, groupColNames] of columnGroups) {
        const groupCols = columns.filter(col => groupColNames.includes(col.name));
        if (groupCols.length === 0) continue;

        sections.push(
          <div key={groupName} className="mb-4">
            <div className="flex items-center justify-between mb-1 px-1">
              <span className="text-xs font-bold text-brand-primary uppercase tracking-wide">
                {groupName}
              </span>
              <div className="flex space-x-1">
                <button
                  onClick={() => onColumnGroupUpdate(groupColNames, true)}
                  className="text-xs px-1.5 py-0.5 bg-brand-primary text-white rounded hover:bg-brand-dark"
                >
                  Show all
                </button>
                <button
                  onClick={() => onColumnGroupUpdate(groupColNames, false)}
                  className="text-xs px-1.5 py-0.5 bg-gray-400 text-white rounded hover:bg-gray-600"
                >
                  Hide all
                </button>
              </div>
            </div>
            {groupCols.map(col => {
              const i = columns.indexOf(col);
              grouped.add(col.name);
              return renderColumnItem(col, i);
            })}
          </div>
        );
      }

      // Ungrouped columns
      const ungrouped = columns.filter(col => !grouped.has(col.name));
      if (ungrouped.length > 0) {
        sections.push(
          <div key="__ungrouped__" className="mb-4">
            <div className="px-1 mb-1">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Other</span>
            </div>
            {ungrouped.map(col => {
              const i = columns.indexOf(col);
              return renderColumnItem(col, i);
            })}
          </div>
        );
      }

      return <>{sections}</>;
    }

    return <>{columns.map((col, i) => renderColumnItem(col, i))}</>;
  };

  const renderColumnItem = (col: Column, i: number) => (
    <div
      key={col.name + i}
      className={`p-3 rounded-lg border transition-colors mb-2 ${col.visible ? 'bg-gray-200 border-gray-400' : 'bg-white border-gray-200 opacity-60'
        }`}
    >
      <input
        type="text"
        value={col.name}
        onChange={(e) => onColumnUpdate(i, { ...col, name: e.target.value })}
        className="w-full p-1 mb-2 font-semibold border rounded-md"
      />
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <label htmlFor={`visible-toggle-${i}`} className="font-semibold text-gray-700">
            Visible
          </label>
          <button
            type="button"
            id={`visible-toggle-${i}`}
            onClick={() => onColumnUpdate(i, { ...col, visible: !col.visible })}
            className={`${col.visible ? 'bg-brand-primary' : 'bg-gray-200'
              } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-brand-primary focus:ring-offset-2`}
            role="switch"
            aria-checked={col.visible}
          >
            <span
              aria-hidden="true"
              className={`${col.visible ? 'translate-x-5' : 'translate-x-0'
                } pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
            />
          </button>
        </div>
        <div className="flex items-center justify-between text-sm">
          <label htmlFor={`log-toggle-${i}`} className="font-semibold text-gray-700">
            Log Scale
          </label>
          <button
            type="button"
            id={`log-toggle-${i}`}
            onClick={() => onColumnUpdate(i, { ...col, scale: col.scale === 'log' ? 'linear' : 'log' })}
            className={`${col.scale === 'log' ? 'bg-brand-primary' : 'bg-gray-200'
              } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-brand-primary focus:ring-offset-2`}
            role="switch"
            aria-checked={col.scale === 'log'}
          >
            <span
              aria-hidden="true"
              className={`${col.scale === 'log' ? 'translate-x-5' : 'translate-x-0'
                } pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
            />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col space-y-6">
      <div>
        <h2 className="text-lg font-bold text-brand-dark mb-3 border-b pb-2">Data Source</h2>
        <FileUpload onDataLoaded={onDataLoaded} />
        {stringColumns.length > 0 && (
          <p className="text-xs text-gray-500 mt-2">
            Label column{stringColumns.length > 1 ? 's' : ''}: {stringColumns.map(c => `"${c}"`).join(', ')}
          </p>
        )}
      </div>

      {recentFiles.length > 0 && (
        <div>
          <h2 className="text-lg font-bold text-brand-dark mb-3 border-b pb-2">Recent Files</h2>
          <div className="space-y-2">
            {recentFiles.map(entry => (
              <div
                key={entry.id}
                className="flex items-center justify-between p-2 bg-gray-50 border border-gray-200 rounded-lg"
              >
                <button
                  onClick={() => onLoadFromHistory(entry)}
                  className="flex-1 text-left min-w-0"
                  title={`Load ${entry.filename}`}
                >
                  <div className="text-sm font-medium text-gray-800 truncate">{entry.filename}</div>
                  <div className="text-xs text-gray-500">{formatRelativeTime(entry.timestamp)}</div>
                </button>
                <button
                  onClick={() => entry.id !== undefined && onDeleteFromHistory(entry.id)}
                  className="ml-2 text-gray-400 hover:text-red-500 flex-shrink-0"
                  title="Remove from history"
                >
                  🗑
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="text-lg font-bold text-brand-dark mb-3 border-b pb-2">Column Filter</h2>
        <div className="space-y-3">
          <div>
            <label htmlFor="columnFilter" className="block text-sm font-medium text-gray-700 mb-1">Filter Columns</label>
            <input
              id="columnFilter"
              type="text"
              value={columnFilter}
              onChange={(e) => onColumnFilterChange(e.target.value)}
              placeholder="e.g. mac1, n_snps (comma-separated)"
              className="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-brand-secondary focus:border-brand-secondary text-sm"
            />
            {columnFilter && (
              <p className="text-xs text-gray-500 mt-1">
                Showing {visibleDisplayCount} of {columns.length} columns
              </p>
            )}
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-bold text-brand-dark mb-3 border-b pb-2">Display Options</h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label htmlFor="filterMode" className="font-semibold text-gray-700">Selection Mode</label>
            <select
              id="filterMode"
              value={filterMode}
              onChange={(e) => setFilterMode(e.target.value as FilterMode)}
              className="p-1 border rounded-md shadow-sm focus:ring-brand-secondary focus:border-brand-secondary"
            >
              <option value="highlight">Highlight</option>
              <option value="filter">Filter</option>
            </select>
          </div>
          <div className="flex items-center justify-between">
            <label htmlFor="showHistograms" className="font-semibold text-gray-700">Show Histograms</label>
            <input
              type="checkbox"
              id="showHistograms"
              checked={showHistograms}
              onChange={(e) => setShowHistograms(e.target.checked)}
              className="h-5 w-5 rounded text-brand-primary focus:ring-brand-secondary"
            />
          </div>
          <div className="flex items-center justify-between">
            <label htmlFor="uniformLogBins" className="font-semibold text-gray-700 text-sm">Uniform Log Bins</label>
            <input
              type="checkbox"
              id="uniformLogBins"
              checked={useUniformLogBins}
              onChange={(e) => setUseUniformLogBins(e.target.checked)}
              disabled={!showHistograms}
              className="h-5 w-5 rounded text-brand-primary focus:ring-brand-secondary disabled:opacity-50"
            />
          </div>
          <div className="flex items-center justify-between">
            <label htmlFor="globalLogScale" className="font-semibold text-gray-700 text-sm">Log Scale All Axes</label>
            <input
              type="checkbox"
              id="globalLogScale"
              checked={globalLogScale}
              onChange={(e) => onToggleGlobalLogScale(e.target.checked)}
              className="h-5 w-5 rounded text-brand-primary focus:ring-brand-secondary"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="cellSize" className="font-semibold text-gray-700 text-sm">Plot size</label>
              <span className="text-xs text-gray-500">{cellSize}px</span>
            </div>
            <input
              type="range"
              id="cellSize"
              min={80}
              max={400}
              step={10}
              value={cellSize}
              onChange={(e) => onCellSizeChange(Number(e.target.value))}
              className="w-full accent-brand-primary"
            />
          </div>
          <button
            onClick={handleDownloadSVG}
            className="w-full mt-4 px-4 py-2 bg-brand-secondary text-white font-semibold rounded-lg shadow-md hover:bg-brand-primary transition-colors flex items-center justify-center space-x-2"
          >
            <DownloadIcon className="h-5 w-5" />
            <span>Download SVG</span>
          </button>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2 border-b pb-2">
          <h2 className="text-lg font-bold text-brand-dark">Columns</h2>
          <button
            onClick={onToggleColumnGroups}
            className={`text-xs px-2 py-1 rounded border transition-colors ${showColumnGroups
              ? 'bg-brand-primary text-white border-brand-primary'
              : 'bg-white text-gray-600 border-gray-300 hover:border-brand-primary hover:text-brand-primary'
              }`}
          >
            {showColumnGroups ? 'Ungroup' : 'Group'}
          </button>
        </div>
        <div className="space-y-1">
          {renderColumnList()}
        </div>
      </div>
    </div>
  );
};
