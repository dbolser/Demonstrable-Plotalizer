import { describe, it, expect } from 'vitest';
import type { Column } from '../../types';

// Helper function to simulate column reordering
function reorderColumns(columns: Column[], dragIndex: number, hoverIndex: number): Column[] {
  const newColumns = [...columns];
  // Perform a direct swap (same logic as in handleColumnReorder)
  [newColumns[dragIndex], newColumns[hoverIndex]] = [newColumns[hoverIndex], newColumns[dragIndex]];
  return newColumns;
}

// Helper function to create mock columns
function createMockColumns(names: string[]): Column[] {
  return names.map(name => ({
    name,
    scale: 'linear' as const,
    visible: true,
  }));
}

describe('Column Reordering Logic', () => {
  it('should swap two adjacent columns correctly', () => {
    const columns = createMockColumns(['col1', 'col2', 'col3']);
    const result = reorderColumns(columns, 0, 1);

    expect(result[0].name).toBe('col2');
    expect(result[1].name).toBe('col1');
    expect(result[2].name).toBe('col3');
  });

  it('should swap non-adjacent columns correctly', () => {
    const columns = createMockColumns(['col1', 'col2', 'col3', 'col4']);
    const result = reorderColumns(columns, 0, 3);

    expect(result[0].name).toBe('col4');
    expect(result[1].name).toBe('col2');
    expect(result[2].name).toBe('col3');
    expect(result[3].name).toBe('col1');
  });

  it('should handle reordering with many columns (30+)', () => {
    const columnNames = Array.from({ length: 30 }, (_, i) => `col${i + 1}`);
    const columns = createMockColumns(columnNames);
    const result = reorderColumns(columns, 0, 29);

    expect(result[0].name).toBe('col30');
    expect(result[29].name).toBe('col1');
    expect(result.length).toBe(30);
  });

  it('should preserve column properties during reordering', () => {
    const columns: Column[] = [
      { name: 'col1', scale: 'linear', visible: true },
      { name: 'col2', scale: 'log', visible: false },
      { name: 'col3', scale: 'linear', visible: true },
    ];

    const result = reorderColumns(columns, 0, 2);

    expect(result[0]).toEqual({ name: 'col3', scale: 'linear', visible: true });
    expect(result[2]).toEqual({ name: 'col1', scale: 'linear', visible: true });
    expect(result[1]).toEqual({ name: 'col2', scale: 'log', visible: false });
  });

  it('should handle edge case of same index', () => {
    const columns = createMockColumns(['col1', 'col2', 'col3']);
    const result = reorderColumns(columns, 1, 1);

    // Should remain unchanged
    expect(result[0].name).toBe('col1');
    expect(result[1].name).toBe('col2');
    expect(result[2].name).toBe('col3');
  });
});

describe('Column Filtering Logic', () => {
  it('should filter columns by substring match', () => {
    const columns = createMockColumns(['n_snps_mac1', 'n_genes_mac1', 'n_snps_mac2', 'other_column']);
    const filter = 'mac1';

    const filteredColumns = columns.map(col => ({
      ...col,
      visible: col.name.toLowerCase().includes(filter.toLowerCase())
    }));

    const visibleColumns = filteredColumns.filter(col => col.visible);
    expect(visibleColumns).toHaveLength(2);
    expect(visibleColumns[0].name).toBe('n_snps_mac1');
    expect(visibleColumns[1].name).toBe('n_genes_mac1');
  });

  it('should handle case insensitive filtering', () => {
    const columns = createMockColumns(['N_SNPS_MAC1', 'n_genes_mac1', 'OTHER_COLUMN']);
    const filter = 'mac1';

    const filteredColumns = columns.map(col => ({
      ...col,
      visible: col.name.toLowerCase().includes(filter.toLowerCase())
    }));

    const visibleColumns = filteredColumns.filter(col => col.visible);
    expect(visibleColumns).toHaveLength(2);
  });

  it('should show all columns when filter is empty', () => {
    const columns = createMockColumns(['col1', 'col2', 'col3']);
    const filter = '';

    const filteredColumns = columns.map(col => ({
      ...col,
      visible: filter === '' || col.name.toLowerCase().includes(filter.toLowerCase())
    }));

    const visibleColumns = filteredColumns.filter(col => col.visible);
    expect(visibleColumns).toHaveLength(3);
  });
});