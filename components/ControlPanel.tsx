import React from 'react';
import type { Column, FilterMode, ColorMode } from '../types';
import type { ColorState } from '../src/utils/colorUtils';
import { FileUpload } from './FileUpload';
import { UrlInput } from './UrlInput';
import { DownloadIcon } from './icons';
import type { FileHistoryEntry } from '../src/utils/fileHistory';
import { formatRelativeTime } from '../src/utils/fileHistory';

export type PCAVarianceEntry = {
  name: string;
  ratio: number; // fraction of total variance explained (0..1)
};

interface ControlPanelProps {
  columns: Column[];
  visibleDisplayCount: number;
  onColumnUpdate: (index: number, updatedColumn: Column) => void;
  onDataLoaded: (data: string, filename: string) => void;
  onLoadFromUrl: (url: string) => void;
  isUrlLoading: boolean;
  filterMode: FilterMode;
  setFilterMode: (mode: FilterMode) => void;
  showHistograms: boolean;
  setShowHistograms: (show: boolean) => void;
  showDataTable: boolean;
  setShowDataTable: (show: boolean) => void;
  useUniformLogBins: boolean;
  setUseUniformLogBins: (useUniform: boolean) => void;
  globalLogScale: boolean;
  onToggleGlobalLogScale: (useLog: boolean) => void;
  showIdentityLine: boolean;
  setShowIdentityLine: (show: boolean) => void;
  showRegressionLine: boolean;
  setShowRegressionLine: (show: boolean) => void;
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
  onAddPCA: () => void;
  pcaVariance: PCAVarianceEntry[] | null;
  colorMode: ColorMode;
  setColorMode: (mode: ColorMode) => void;
  categoryColorColumn: string | null;
  setCategoryColorColumn: (column: string | null) => void;
  rainbowOrderColumn: string | null;
  onResetRainbowOrder: () => void;
  colorState: ColorState | null;
}

export const ControlPanel: React.FC<ControlPanelProps> = ({
  columns,
  visibleDisplayCount,
  onColumnUpdate,
  onDataLoaded,
  onLoadFromUrl,
  isUrlLoading,
  filterMode,
  setFilterMode,
  showHistograms,
  setShowHistograms,
  showDataTable,
  setShowDataTable,
  useUniformLogBins,
  setUseUniformLogBins,
  globalLogScale,
  onToggleGlobalLogScale,
  showIdentityLine,
  setShowIdentityLine,
  showRegressionLine,
  setShowRegressionLine,
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
  onAddPCA,
  pcaVariance,
  colorMode,
  setColorMode,
  categoryColorColumn,
  setCategoryColorColumn,
  rainbowOrderColumn,
  onResetRainbowOrder,
  colorState,
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
        <div className="mt-3">
          <p className="text-xs font-medium text-gray-500 mb-1">Load from URL</p>
          <UrlInput onLoadUrl={onLoadFromUrl} isLoading={isUrlLoading} />
        </div>
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
                key={entry.id ?? `${entry.filename}-${entry.timestamp}`}
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
                  aria-label="Remove from history"
                >
                  <span aria-hidden="true">🗑</span>
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
          <div className="flex items-center justify-between">
            <label htmlFor="showDataTable" className="font-semibold text-gray-700">Show Data Table</label>
            <input
              type="checkbox"
              id="showDataTable"
              checked={showDataTable}
              onChange={(e) => setShowDataTable(e.target.checked)}
              className="h-5 w-5 rounded text-brand-primary focus:ring-brand-secondary"
            />
          </div>
          <div>
            <span className="font-semibold text-gray-700 text-sm">Reference Lines</span>
            <div className="mt-1 space-y-1">
              <div className="flex items-center justify-between">
                <label htmlFor="showIdentityLine" className="text-sm text-gray-600">x = y (identity)</label>
                <input
                  type="checkbox"
                  id="showIdentityLine"
                  checked={showIdentityLine}
                  onChange={(e) => setShowIdentityLine(e.target.checked)}
                  className="h-4 w-4 rounded text-brand-primary focus:ring-brand-secondary"
                />
              </div>
              <div className="flex items-center justify-between">
                <label htmlFor="showRegressionLine" className="text-sm text-gray-600">Regression</label>
                <input
                  type="checkbox"
                  id="showRegressionLine"
                  checked={showRegressionLine}
                  onChange={(e) => setShowRegressionLine(e.target.checked)}
                  className="h-4 w-4 rounded text-brand-primary focus:ring-brand-secondary"
                />
              </div>
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="cellSize" className="font-semibold text-gray-700 text-sm">Plot size</label>
              <span className="text-xs text-gray-500">{cellSize}px</span>
            </div>
            <input
              type="range"
              id="cellSize"
              min={60}
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
        <h2 className="text-lg font-bold text-brand-dark mb-3 border-b pb-2">Color</h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label htmlFor="colorMode" className="font-semibold text-gray-700">Color By</label>
            <select
              id="colorMode"
              value={colorMode}
              onChange={(e) => setColorMode(e.target.value as ColorMode)}
              className="p-1 border rounded-md shadow-sm focus:ring-brand-secondary focus:border-brand-secondary"
            >
              <option value="none">None</option>
              <option value="category" disabled={stringColumns.length === 0}>Category</option>
              <option value="rainbow">Rainbow</option>
            </select>
          </div>

          {colorMode === 'category' && (
            <div>
              <label htmlFor="categoryColorColumn" className="block text-sm font-medium text-gray-700 mb-1">
                Category column
              </label>
              <select
                id="categoryColorColumn"
                value={categoryColorColumn ?? ''}
                onChange={(e) => setCategoryColorColumn(e.target.value || null)}
                className="w-full p-1 border rounded-md shadow-sm focus:ring-brand-secondary focus:border-brand-secondary text-sm"
              >
                <option value="">Choose a column…</option>
                {stringColumns.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
              {colorState?.categories && colorState.categories.length > 0 && (
                <div className="mt-2 space-y-1" data-testid="category-legend">
                  {colorState.categories.slice(0, 15).map(entry => (
                    <div key={entry.name} className="flex items-center text-xs text-gray-700">
                      <span
                        className="inline-block w-3 h-3 rounded-sm mr-2 flex-shrink-0"
                        style={{ backgroundColor: entry.color }}
                        aria-hidden="true"
                      />
                      <span className="truncate" title={entry.name}>{entry.name}</span>
                    </div>
                  ))}
                  {colorState.categories.length > 15 && (
                    <p className="text-xs text-gray-500">
                      +{colorState.categories.length - 15} more (colors repeat every 10 categories)
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {colorMode === 'rainbow' && colorState && (
            <div>
              <div
                className="h-3 w-full rounded"
                data-testid="rainbow-legend"
                style={{
                  background: `linear-gradient(to right, ${colorState.slotColors
                    .filter((_, i) => i % 8 === 0 || i === colorState.slotColors.length - 1)
                    .join(', ')})`,
                }}
              />
              <div className="flex justify-between text-[10px] text-gray-500 mt-0.5">
                <span>{rainbowOrderColumn ? 'lowest' : 'first row'}</span>
                <span>{rainbowOrderColumn ? 'highest' : 'last row'}</span>
              </div>
              <p className="text-xs text-gray-600 mt-2">
                Order:{' '}
                {rainbowOrderColumn
                  ? <>ranked by <span className="font-semibold text-purple-700">{rainbowOrderColumn}</span></>
                  : <span className="font-semibold">file order</span>}
              </p>
              {rainbowOrderColumn ? (
                <button
                  onClick={onResetRainbowOrder}
                  className="mt-1 text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:border-brand-primary hover:text-brand-primary transition-colors"
                >
                  Reset to file order
                </button>
              ) : (
                <p className="text-xs text-gray-500 mt-1">
                  Tip: click a column label on the matrix diagonal to order the gradient by that column's rank. Rows with missing values are shown in gray.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <div>
        <h2 className="text-lg font-bold text-brand-dark mb-3 border-b pb-2">Analysis</h2>
        <button
          onClick={onAddPCA}
          className="w-full px-4 py-2 bg-brand-secondary text-white font-semibold rounded-lg shadow-md hover:bg-brand-primary transition-colors"
          title="Compute PCA over the visible numeric columns and add PC1-PC3 as derived columns"
        >
          Add PCA Columns
        </button>
        {pcaVariance && pcaVariance.length > 0 && (
          <p className="text-xs text-gray-500 mt-2">
            Explained variance:{' '}
            {pcaVariance.map(pc => `${pc.name} ${(pc.ratio * 100).toFixed(1)}%`).join(', ')}
          </p>
        )}
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
