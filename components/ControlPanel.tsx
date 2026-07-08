import React, { useEffect, useRef, useState } from 'react';
import type { Column, FilterMode, ColorMode } from '../types';
import type { CorrelationKind } from '../src/utils/correlationUtils';
import type { ColorState } from '../src/utils/colorUtils';
import type { FacetColumnSummary, FacetSelections } from '../src/utils/facetUtils';
import { FileUpload } from './FileUpload';
import { UrlInput } from './UrlInput';
import { PanelSection } from './PanelSection';
import { DownloadIcon, LinkIcon } from './icons';
import { renderMatrixToPngBlob, downloadBlob } from '../src/utils/exportPng';
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
  showCorrelation: boolean;
  setShowCorrelation: (show: boolean) => void;
  tintCellBorders: boolean;
  setTintCellBorders: (tint: boolean) => void;
  correlationMetric: CorrelationKind;
  setCorrelationMetric: (kind: CorrelationKind) => void;
  onSortByCorrelation: () => void;
  canRestoreColumnOrder: boolean;
  onRestoreColumnOrder: () => void;
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
  facetSummaries: FacetColumnSummary[];
  facetSelections: FacetSelections;
  activeFacetCount: number;
  onToggleFacetValue: (column: string, value: string) => void;
  onSetColumnFacet: (column: string, values: Set<string> | null) => void;
  onClearAllFacets: () => void;
  // Issue #43: shareable view links.
  onBuildShareLink: () => string;
  shareLinkIncludesData: boolean;
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
  showCorrelation,
  setShowCorrelation,
  tintCellBorders,
  setTintCellBorders,
  correlationMetric,
  setCorrelationMetric,
  onSortByCorrelation,
  canRestoreColumnOrder,
  onRestoreColumnOrder,
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
  facetSummaries,
  facetSelections,
  activeFacetCount,
  onToggleFacetValue,
  onSetColumnFacet,
  onClearAllFacets,
  onBuildShareLink,
  shareLinkIncludesData,
}) => {
  // Facet columns are collapsed by default; a column with an active facet
  // still shows its "filtered" badge while collapsed.
  const [expandedFacetColumns, setExpandedFacetColumns] = useState<Set<string>>(new Set());

  const toggleFacetColumnExpanded = (column: string) => {
    setExpandedFacetColumns(prev => {
      const next = new Set(prev);
      if (next.has(column)) next.delete(column);
      else next.add(column);
      return next;
    });
  };

  // Issue #43: "Copy Share Link" feedback. 'copied' flashes briefly;
  // 'failed' shows the link in a select-all input for manual copying.
  const [shareStatus, setShareStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [failedShareLink, setFailedShareLink] = useState<string>('');
  const shareResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (shareResetTimerRef.current) clearTimeout(shareResetTimerRef.current);
  }, []);

  const handleCopyShareLink = async () => {
    const link = onBuildShareLink();
    let copied = false;
    // Primary path; may be unavailable (insecure context) or blocked.
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(link);
        copied = true;
      } catch {
        copied = false;
      }
    }
    if (!copied) {
      // Fallback: hidden textarea + execCommand('copy').
      try {
        const textarea = document.createElement('textarea');
        textarea.value = link;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        copied = document.execCommand('copy');
        document.body.removeChild(textarea);
      } catch {
        copied = false;
      }
    }
    if (shareResetTimerRef.current) clearTimeout(shareResetTimerRef.current);
    if (copied) {
      setShareStatus('copied');
      setFailedShareLink('');
      shareResetTimerRef.current = setTimeout(() => setShareStatus('idle'), 2000);
    } else {
      setShareStatus('failed');
      setFailedShareLink(link);
    }
  };

  const handleDownloadPNG = async () => {
    // The points live on Canvas layers, not in the SVG, so a plain SVG
    // serialization exports an empty plot — composite both into a PNG.
    const svgElement = document.querySelector<SVGSVGElement>('#scatterplot-matrix-svg');
    const canvasContainer = document.querySelector<HTMLElement>('#scatterplot-matrix-canvases');
    if (!svgElement || !canvasContainer) {
      alert('Could not find the plot to export — load some data first.');
      return;
    }
    try {
      const blob = await renderMatrixToPngBlob(svgElement, canvasContainer, 2);
      downloadBlob(blob, 'scatter-plot-matrix.png');
    } catch (err) {
      alert(`PNG export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
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

  // Collapsed-header status hints, cheaply derived from existing props.
  const hiddenColumnCount = columns.filter(col => !col.visible).length;
  const columnsHint = hiddenColumnCount > 0 ? `${hiddenColumnCount} hidden` : null;
  const colorHint =
    colorMode === 'none'
      ? null
      : colorMode === 'category'
        ? `category${categoryColorColumn ? `: ${categoryColorColumn}` : ''}`
        : 'rainbow';
  const analysisHint = correlationMetric !== 'pearson' ? 'Spearman' : null;
  const facetsHint = activeFacetCount > 0 ? `${activeFacetCount} active` : null;

  return (
    <div className="flex flex-col space-y-6">
      <PanelSection title="Data" defaultOpen>
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
        {recentFiles.length > 0 && (
          <div className="mt-4">
            <p className="text-sm font-semibold text-gray-700 mb-2">Recent Files</p>
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
      </PanelSection>

      <PanelSection title="Columns" defaultOpen hint={columnsHint}>
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
          <div className="flex items-center justify-end">
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
      </PanelSection>

      <PanelSection title="View" defaultOpen>
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
            <span className="font-semibold text-gray-700 text-sm">Correlation</span>
            <div className="mt-1 space-y-1">
              <div className="flex items-center justify-between">
                <label htmlFor="showCorrelation" className="text-sm text-gray-600">Show correlation</label>
                <input
                  type="checkbox"
                  id="showCorrelation"
                  checked={showCorrelation}
                  onChange={(e) => setShowCorrelation(e.target.checked)}
                  className="h-4 w-4 rounded text-brand-primary focus:ring-brand-secondary"
                />
              </div>
              <div className="flex items-center justify-between">
                <label htmlFor="tintCellBorders" className="text-sm text-gray-600">Tint borders by |r|</label>
                <input
                  type="checkbox"
                  id="tintCellBorders"
                  checked={tintCellBorders}
                  onChange={(e) => setTintCellBorders(e.target.checked)}
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
        </div>
      </PanelSection>

      <PanelSection title="Color" defaultOpen={colorMode !== 'none'} hint={colorHint}>
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
      </PanelSection>

      {facetSummaries.length > 0 && (
        <PanelSection
          title="Facets"
          defaultOpen={activeFacetCount > 0}
          hint={facetsHint}
          testId="facets-section"
          badge={
            activeFacetCount > 0 ? (
              <span
                className="ml-2 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 text-xs font-semibold text-white bg-brand-primary rounded-full"
                title={`${activeFacetCount} active facet${activeFacetCount > 1 ? 's' : ''}`}
                data-testid="active-facet-count"
              >
                {activeFacetCount}
              </span>
            ) : null
          }
        >
          <div className="flex items-start justify-between mb-2">
            <p className="text-xs text-gray-500 pr-2">
              Check values to restrict the plotted rows. Columns with nothing checked show all rows.
            </p>
            {activeFacetCount > 0 && (
              <button
                onClick={onClearAllFacets}
                className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:border-brand-primary hover:text-brand-primary transition-colors flex-shrink-0"
              >
                Clear all
              </button>
            )}
          </div>
          <div className="space-y-2">
            {facetSummaries.map(summary => {
              const selected = facetSelections.get(summary.column);
              const isActive = !!selected && selected.size > 0;
              const isExpanded = expandedFacetColumns.has(summary.column);
              return (
                <div
                  key={summary.column}
                  className={`rounded-lg border ${isActive ? 'border-brand-primary bg-blue-50' : 'border-gray-200 bg-gray-50'}`}
                >
                  <button
                    onClick={() => toggleFacetColumnExpanded(summary.column)}
                    className="w-full flex items-center justify-between p-2 text-left"
                    aria-expanded={isExpanded}
                  >
                    <span className="text-sm font-semibold text-gray-700 truncate" title={summary.column}>
                      <span aria-hidden="true" className="mr-1 text-gray-400">{isExpanded ? '▾' : '▸'}</span>
                      {summary.column}
                    </span>
                    {isActive && (
                      <span className="text-xs text-brand-primary font-medium flex-shrink-0 ml-2">
                        {selected!.size} of {summary.values.length}
                      </span>
                    )}
                  </button>
                  {isExpanded && (
                    summary.facetable ? (
                      <div className="px-2 pb-2">
                        <div className="flex space-x-1 mb-1">
                          <button
                            onClick={() =>
                              onSetColumnFacet(summary.column, new Set(summary.values.map(v => v.value)))
                            }
                            className="text-xs px-1.5 py-0.5 bg-brand-primary text-white rounded hover:bg-brand-dark"
                          >
                            All
                          </button>
                          <button
                            onClick={() => onSetColumnFacet(summary.column, null)}
                            className="text-xs px-1.5 py-0.5 bg-gray-400 text-white rounded hover:bg-gray-600"
                          >
                            None
                          </button>
                        </div>
                        <div className="max-h-48 overflow-y-auto space-y-0.5">
                          {summary.values.map(entry => (
                            <label
                              key={entry.value}
                              className="flex items-center text-xs text-gray-700 cursor-pointer hover:bg-gray-100 rounded px-1 py-0.5"
                            >
                              <input
                                type="checkbox"
                                checked={!!selected?.has(entry.value)}
                                onChange={() => onToggleFacetValue(summary.column, entry.value)}
                                className="h-3.5 w-3.5 rounded text-brand-primary focus:ring-brand-secondary mr-2 flex-shrink-0"
                              />
                              <span
                                className={`truncate ${entry.isMissing ? 'italic text-gray-500' : ''}`}
                                title={entry.value}
                              >
                                {entry.value}
                              </span>
                              <span className="ml-auto pl-2 text-gray-400 flex-shrink-0">({entry.count})</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="px-2 pb-2 text-xs text-gray-500">
                        Column has {summary.distinctCount} distinct values — too many to facet.
                      </p>
                    )
                  )}
                </div>
              );
            })}
          </div>
        </PanelSection>
      )}

      <PanelSection title="Analysis" hint={analysisHint}>
        <div className="space-y-3">
          <div>
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
            <span className="font-semibold text-gray-700 text-sm">Correlation</span>
            <div className="mt-1 space-y-1">
              <div className="flex items-center justify-between">
                <label htmlFor="correlationMetric" className="text-sm text-gray-600">Metric</label>
                <select
                  id="correlationMetric"
                  value={correlationMetric}
                  onChange={(e) => setCorrelationMetric(e.target.value as CorrelationKind)}
                  className="p-1 border rounded-md shadow-sm text-sm focus:ring-brand-secondary focus:border-brand-secondary"
                >
                  <option value="pearson">Pearson (r)</option>
                  <option value="spearman">Spearman (ρ)</option>
                </select>
              </div>
              <div className="flex items-center space-x-1 pt-1">
                <button
                  onClick={onSortByCorrelation}
                  className="flex-1 text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:border-brand-primary hover:text-brand-primary transition-colors"
                  title="Reorder visible columns by mean absolute correlation against the other visible columns (descending)"
                >
                  Sort columns by |r|
                </button>
                {canRestoreColumnOrder && (
                  <button
                    onClick={onRestoreColumnOrder}
                    className="flex-1 text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:border-brand-primary hover:text-brand-primary transition-colors"
                    title="Restore the column order from before the sort"
                  >
                    Restore order
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </PanelSection>

      <PanelSection title="Export">
        <div className="space-y-2">
          <button
            onClick={handleDownloadPNG}
            className="w-full px-4 py-2 bg-brand-secondary text-white font-semibold rounded-lg shadow-md hover:bg-brand-primary transition-colors flex items-center justify-center space-x-2"
          >
            <DownloadIcon className="h-5 w-5" />
            <span>Download PNG</span>
          </button>
          <button
            onClick={handleCopyShareLink}
            className="w-full px-4 py-2 bg-brand-secondary text-white font-semibold rounded-lg shadow-md hover:bg-brand-primary transition-colors flex items-center justify-center space-x-2"
            title={shareLinkIncludesData
              ? 'Copy a link that reloads this data and view'
              : 'Copy a link that restores this view (data not included)'}
          >
            <LinkIcon className="h-5 w-5" />
            <span>{shareStatus === 'copied' ? 'Copied!' : 'Copy Share Link'}</span>
          </button>
          {shareStatus === 'failed' && (
            <div className="text-xs text-red-700">
              <p className="mb-1">Couldn't access the clipboard — copy the link manually:</p>
              <input
                type="text"
                readOnly
                value={failedShareLink}
                onFocus={(e) => e.target.select()}
                className="w-full p-1 border border-red-300 rounded text-xs font-mono"
                aria-label="Share link"
              />
            </div>
          )}
          {!shareLinkIncludesData && (
            <p className="text-xs text-gray-500">
              This data was loaded from a local file, so the link restores your
              view only — the recipient must load the same file.
            </p>
          )}
        </div>
      </PanelSection>
    </div>
  );
};
