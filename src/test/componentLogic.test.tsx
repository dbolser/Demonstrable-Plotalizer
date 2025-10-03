import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import App from '../../App';
import { reorderColumns, filterColumns, mapVisibleColumns } from '../utils/columnUtils';
import { filterData } from '../utils/dataUtils';

// Mock PapaParse
vi.mock('papaparse', () => ({
  default: {
    parse: vi.fn(() => ({
      data: [
        { col1: 10, col2: 20, col3: 30 },
        { col1: 15, col2: 25, col3: 35 },
      ],
      errors: [],
      meta: { fields: ['col1', 'col2', 'col3'] }
    }))
  }
}));

// Mock fetch for sample data
global.fetch = vi.fn(() =>
  Promise.resolve({
    text: () => Promise.resolve('col1,col2,col3\n10,20,30\n15,25,35')
  } as Response)
);

describe('App Component Logic', () => {
  it('should render without crashing', async () => {
    expect(() => {
      render(<App />);
    }).not.toThrow();
  });

  it('should handle column filtering logic', () => {
    const columns = [
      { name: 'n_snps_mac1', scale: 'linear' as const, visible: true },
      { name: 'n_genes_mac1', scale: 'linear' as const, visible: true },
      { name: 'n_snps_mac2', scale: 'linear' as const, visible: true },
      { name: 'other_column', scale: 'linear' as const, visible: true },
    ];

    const filter = 'mac1';
    const filteredColumns = filterColumns(columns, filter);

    const visibleColumns = filteredColumns.filter(col => col.visible);
    expect(visibleColumns).toHaveLength(2);
    expect(visibleColumns.map(c => c.name)).toEqual(['n_snps_mac1', 'n_genes_mac1']);
  });

  it('should handle column reordering logic', () => {
    const columns = [
      { name: 'col1', scale: 'linear' as const, visible: true },
      { name: 'col2', scale: 'linear' as const, visible: true },
      { name: 'col3', scale: 'linear' as const, visible: true },
    ];

    const reordered = reorderColumns(columns, 0, 2);
    expect(reordered[0].name).toBe('col3');
    expect(reordered[2].name).toBe('col1');
    expect(reordered[1].name).toBe('col2');
  });

  it('should handle data filtering correctly', () => {
    const data = [
      { __id: 0, col1: 10, col2: 20 },
      { __id: 1, col1: 15, col2: 25 },
      { __id: 2, col1: 20, col2: 30 },
    ];

    const selectedIds = new Set([0, 2]);

    // Test highlight mode (shows all data)
    const highlightModeData = filterData(data, selectedIds, 'highlight');
    expect(highlightModeData.filteredData).toHaveLength(3);
    expect(highlightModeData.selectedData).toHaveLength(2);

    // Test filter mode (shows only selected)
    const filterModeData = filterData(data, selectedIds, 'filter');
    expect(filterModeData.filteredData).toHaveLength(2);
    expect(filterModeData.selectedData).toHaveLength(2);
  });

  it('should handle visible columns mapping correctly', () => {
    const columns = [
      { name: 'col1', scale: 'linear' as const, visible: true },
      { name: 'col2', scale: 'linear' as const, visible: false },
      { name: 'col3', scale: 'linear' as const, visible: true },
      { name: 'col4', scale: 'linear' as const, visible: true },
    ];

    const {
      visibleColumns,
      visibleIndexToOriginalIndex,
      originalIndexToVisibleIndex,
    } = mapVisibleColumns(columns);

    expect(visibleColumns).toHaveLength(3);
    expect(visibleColumns.map(c => c.name)).toEqual(['col1', 'col3', 'col4']);
    expect(visibleIndexToOriginalIndex.get(0)).toBe(0); // col1
    expect(visibleIndexToOriginalIndex.get(1)).toBe(2); // col3
    expect(visibleIndexToOriginalIndex.get(2)).toBe(3); // col4
    expect(originalIndexToVisibleIndex.get(2)).toBe(1); // col3 is at visible index 1
  });
});