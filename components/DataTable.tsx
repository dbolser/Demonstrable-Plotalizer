import React, { useState, useMemo, useRef, useLayoutEffect, useCallback } from 'react';
import type { DataPoint, Column } from '../types';
import { computeRowWindow, TABLE_ROW_HEIGHT } from '../src/utils/tableLayout';

interface DataTableProps {
  data: DataPoint[];
  columns: Column[];
  stringColumns: string[];
  /** Panel heading; defaults to "Selected Data" for selection views. */
  heading?: string;
}

type SortConfig = {
    key: string;
    direction: 'asc' | 'desc';
} | null;

/**
 * Data table with windowed ("virtualized") rendering: only the rows in the
 * scroll viewport (plus a small overscan) exist in the DOM, with spacer rows
 * standing in for the rest. The full dataset — 30k+ rows — is scrollable
 * without a row cap and without DOM blowup. Rows have a fixed height
 * (TABLE_ROW_HEIGHT); the windowing math lives in src/utils/tableLayout.ts.
 */
export const DataTable: React.FC<DataTableProps> = ({
  data,
  columns,
  stringColumns,
  heading = 'Selected Data'
}) => {
    const [sortConfig, setSortConfig] = useState<SortConfig>(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [viewportHeight, setViewportHeight] = useState(400);
    const scrollContainerRef = useRef<HTMLDivElement>(null);

  const visibleColumns = columns.filter(c => c.visible);

    // Keep viewportHeight in sync with the container (the table panel is
    // user-resizable via the divider, so it changes outside of scrolling).
    useLayoutEffect(() => {
        const el = scrollContainerRef.current;
        if (!el) return;
        setViewportHeight(el.clientHeight);
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(() => setViewportHeight(el.clientHeight));
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
        setScrollTop(e.currentTarget.scrollTop);
    }, []);

    // Sort data based on current sort configuration
    const sortedData = useMemo(() => {
        if (!sortConfig) return data;

        const sorted = [...data].sort((a, b) => {
            const aVal = a[sortConfig.key];
            const bVal = b[sortConfig.key];

            // Handle null/undefined
            if (aVal == null && bVal == null) return 0;
            if (aVal == null) return 1;
            if (bVal == null) return -1;

            // Compare numbers
            if (typeof aVal === 'number' && typeof bVal === 'number') {
                return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
            }

            // Compare strings
            const aStr = String(aVal).toLowerCase();
            const bStr = String(bVal).toLowerCase();
            if (aStr < bStr) return sortConfig.direction === 'asc' ? -1 : 1;
            if (aStr > bStr) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });

        return sorted;
    }, [data, sortConfig]);

    const totalRows = sortedData.length;
    const { start, end, padTop, padBottom } = computeRowWindow(
        scrollTop,
        viewportHeight,
        totalRows
    );
    const windowRows = sortedData.slice(start, end);
    const columnCount = stringColumns.length + visibleColumns.length;

    const handleSort = (key: string) => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
        // Jump back to the top so the new order is seen from its start.
        if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
        setScrollTop(0);
    };

  if (totalRows === 0) {
    return null;
  }

  return (
      <div className="bg-white border-t border-gray-200 p-4 h-full flex flex-col overflow-hidden">
          <div className="flex justify-between items-center mb-3 flex-shrink-0">
        <div className="flex items-baseline space-x-3">
          <h3 className="text-lg font-semibold text-gray-800">
            {heading} ({totalRows.toLocaleString()} row{totalRows !== 1 ? 's' : ''})
          </h3>
        </div>
      </div>

          <div
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className="overflow-auto border border-gray-300 rounded-lg flex-1"
          >
        <table className="min-w-full divide-y divide-gray-300">
          <thead className="bg-gray-50 sticky top-0 z-10">
            <tr>
              {stringColumns.map(colName => (
                <th
                  key={colName}
                  className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider border-r border-gray-300 cursor-pointer hover:bg-gray-100 select-none"
                  onClick={() => handleSort(colName)}
                >
                  <div className="flex items-center space-x-1">
                    <span>{colName}</span>
                    {sortConfig?.key === colName && (
                      <span className="text-brand-primary">
                        {sortConfig.direction === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </div>
                </th>
              ))}
              {visibleColumns.map(col => (
                <th
                  key={col.name}
                      className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort(col.name)}
                >
                      <div className="flex items-center space-x-1">
                          <span>{col.name}</span>
                          {sortConfig?.key === col.name && (
                              <span className="text-brand-primary">
                                  {sortConfig.direction === 'asc' ? '↑' : '↓'}
                              </span>
                          )}
                      </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {padTop > 0 && (
              <tr aria-hidden="true" style={{ height: padTop }}>
                <td colSpan={columnCount} className="p-0" />
              </tr>
            )}
            {windowRows.map((row, idx) => {
              const rowIndex = start + idx;
              return (
                <tr
                  key={row.__id}
                  style={{ height: TABLE_ROW_HEIGHT }}
                  className={rowIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
                >
                  {stringColumns.map(colName => (
                    <td key={colName} className="px-3 py-2 text-sm text-gray-900 border-r border-gray-200 font-medium whitespace-nowrap">
                      {String(row[colName] ?? '')}
                    </td>
                  ))}
                  {visibleColumns.map(col => {
                    const value = row[col.name];
                    const displayValue = typeof value === 'number'
                      ? value.toLocaleString(undefined, { maximumFractionDigits: 4 })
                      : String(value ?? '');
                    return (
                      <td
                        key={col.name}
                        className="px-3 py-2 text-sm text-gray-700 font-mono whitespace-nowrap"
                      >
                        {displayValue}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {padBottom > 0 && (
              <tr aria-hidden="true" style={{ height: padBottom }}>
                <td colSpan={columnCount} className="p-0" />
              </tr>
            )}
          </tbody>
        </table>
      </div>

          <div className="mt-2 text-xs text-gray-500 flex-shrink-0">
        Showing rows {(start + 1).toLocaleString()}-{end.toLocaleString()} of {totalRows.toLocaleString()}
      </div>
    </div>
  );
};
