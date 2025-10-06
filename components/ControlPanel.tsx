import React from 'react';
import type { Column, FilterMode } from '../types';
import { FileUpload } from './FileUpload';
import { DownloadIcon } from './icons';

interface ControlPanelProps {
  columns: Column[];
  onColumnUpdate: (index: number, updatedColumn: Column) => void;
  onDataLoaded: (data: string) => void;
  filterMode: FilterMode;
  setFilterMode: (mode: FilterMode) => void;
  showHistograms: boolean;
  setShowHistograms: (show: boolean) => void;
  useUniformLogBins: boolean;
  setUseUniformLogBins: (useUniform: boolean) => void;
  globalLogScale: boolean;
  onToggleGlobalLogScale: (useLog: boolean) => void;
  labelColumn: string | null;
  columnFilter: string;
  onColumnFilterChange: (filter: string) => void;
}

export const ControlPanel: React.FC<ControlPanelProps> = ({
  columns,
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
  labelColumn,
  columnFilter,
  onColumnFilterChange,
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

  return (
    <div className="flex flex-col space-y-6">
      <div>
        <h2 className="text-lg font-bold text-brand-dark mb-3 border-b pb-2">Data Source</h2>
        <FileUpload onDataLoaded={onDataLoaded} />
         {labelColumn && (
            <p className="text-xs text-gray-500 mt-2">
                Using column <span className="font-semibold">"{labelColumn}"</span> for point labels.
            </p>
        )}
      </div>

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
              placeholder="Type to filter columns (e.g. mac1, n_snps)"
              className="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-brand-secondary focus:border-brand-secondary text-sm"
            />
            {columnFilter && (
              <p className="text-xs text-gray-500 mt-1">
                Showing {columns.filter(col => col.visible).length} of {columns.length} columns
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
        <h2 className="text-lg font-bold text-brand-dark mb-2 border-b pb-2">Columns</h2>
        <div className="space-y-4">
          {columns.map((col, i) => (
            <div
              key={col.name + i}
              className={`p-3 rounded-lg border transition-colors ${col.visible ? 'bg-gray-200 border-gray-400' : 'bg-white border-gray-200 opacity-60'
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
                    className={`${
                      col.visible ? 'bg-brand-primary' : 'bg-gray-200'
                    } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-brand-primary focus:ring-offset-2`}
                    role="switch"
                    aria-checked={col.visible}
                  >
                    <span
                      aria-hidden="true"
                      className={`${
                        col.visible ? 'translate-x-5' : 'translate-x-0'
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
                    className={`${
                      col.scale === 'log' ? 'bg-brand-primary' : 'bg-gray-200'
                    } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-brand-primary focus:ring-offset-2`}
                    role="switch"
                    aria-checked={col.scale === 'log'}
                  >
                    <span
                      aria-hidden="true"
                      className={`${
                        col.scale === 'log' ? 'translate-x-5' : 'translate-x-0'
                      } pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                    />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};