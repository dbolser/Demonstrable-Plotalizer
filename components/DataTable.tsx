import React, { useState, useMemo } from 'react';
import type { DataPoint, Column } from '../types';

interface DataTableProps {
  data: DataPoint[];
  columns: Column[];
  stringColumns: string[];
  maxRows?: number;
}

type SortConfig = {
    key: string;
    direction: 'asc' | 'desc';
} | null;

export const DataTable: React.FC<DataTableProps> = ({
  data,
  columns,
  stringColumns,
  maxRows = 20
}) => {
  const [currentPage, setCurrentPage] = useState(0);
    const [sortConfig, setSortConfig] = useState<SortConfig>(null);

  const visibleColumns = columns.filter(c => c.visible);

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
  const totalPages = Math.ceil(totalRows / maxRows);
  const startIdx = currentPage * maxRows;
  const endIdx = Math.min(startIdx + maxRows, totalRows);
    const pageData = sortedData.slice(startIdx, endIdx);

    const handleSort = (key: string) => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
        setCurrentPage(0); // Reset to first page when sorting
    };

  if (totalRows === 0) {
    return null;
  }

  return (
      <div className="bg-white border-t border-gray-200 p-4 h-full flex flex-col overflow-hidden">
          <div className="flex justify-between items-center mb-3 flex-shrink-0">
        <h3 className="text-lg font-semibold text-gray-800">
          Selected Data ({totalRows.toLocaleString()} row{totalRows !== 1 ? 's' : ''})
        </h3>
        {totalPages > 1 && (
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
              disabled={currentPage === 0}
              className="px-3 py-1 bg-gray-200 text-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-300"
            >
              ← Prev
            </button>
            <span className="text-sm text-gray-600">
              Page {currentPage + 1} of {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={currentPage >= totalPages - 1}
              className="px-3 py-1 bg-gray-200 text-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-300"
            >
              Next →
            </button>
          </div>
        )}
      </div>

          <div className="overflow-auto border border-gray-300 rounded-lg flex-1">
        <table className="min-w-full divide-y divide-gray-300">
          <thead className="bg-gray-50">
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
            {pageData.map((row, idx) => (
              <tr key={row.__id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                {stringColumns.map(colName => (
                  <td key={colName} className="px-3 py-2 text-sm text-gray-900 border-r border-gray-200 font-medium">
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
                      className="px-3 py-2 text-sm text-gray-700 font-mono"
                    >
                      {displayValue}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

          <div className="mt-2 text-xs text-gray-500 flex-shrink-0">
        Showing {startIdx + 1}-{endIdx} of {totalRows.toLocaleString()} row{totalRows !== 1 ? 's' : ''}
      </div>
    </div>
  );
};
