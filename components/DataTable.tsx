import React, { useState } from 'react';
import type { DataPoint, Column } from '../types';

interface DataTableProps {
  data: DataPoint[];
  columns: Column[];
  labelColumn: string | null;
  maxRows?: number;
}

export const DataTable: React.FC<DataTableProps> = ({ 
  data, 
  columns, 
  labelColumn,
  maxRows = 20 
}) => {
  const [currentPage, setCurrentPage] = useState(0);
  
  const visibleColumns = columns.filter(c => c.visible);
  const totalRows = data.length;
  const totalPages = Math.ceil(totalRows / maxRows);
  const startIdx = currentPage * maxRows;
  const endIdx = Math.min(startIdx + maxRows, totalRows);
  const pageData = data.slice(startIdx, endIdx);

  if (totalRows === 0) {
    return null;
  }

  return (
    <div className="bg-white border-t border-gray-200 p-4">
      <div className="flex justify-between items-center mb-3">
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

      <div className="overflow-x-auto border border-gray-300 rounded-lg">
        <table className="min-w-full divide-y divide-gray-300">
          <thead className="bg-gray-50">
            <tr>
              {labelColumn && (
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider border-r border-gray-300">
                  {labelColumn}
                </th>
              )}
              {visibleColumns.map(col => (
                <th 
                  key={col.name} 
                  className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider"
                >
                  {col.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {pageData.map((row, idx) => (
              <tr key={row.__id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                {labelColumn && (
                  <td className="px-3 py-2 text-sm text-gray-900 border-r border-gray-200 font-medium">
                    {String(row[labelColumn] ?? '')}
                  </td>
                )}
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

      <div className="mt-2 text-xs text-gray-500">
        Showing {startIdx + 1}-{endIdx} of {totalRows.toLocaleString()} row{totalRows !== 1 ? 's' : ''}
      </div>
    </div>
  );
};
