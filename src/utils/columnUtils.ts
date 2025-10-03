import type { Column } from '../types';
import { filterData } from '../utils/dataUtils';

export function reorderColumns(columns: Column[], dragIndex: number, hoverIndex: number): Column[] {
    const newColumns = [...columns];
    [newColumns[dragIndex], newColumns[hoverIndex]] = [newColumns[hoverIndex], newColumns[dragIndex]];
    return newColumns;
}

export function filterColumns(columns: Column[], filter: string): Column[] {
    return columns.map(col => ({
        ...col,
        visible: filter === '' || col.name.toLowerCase().includes(filter.toLowerCase())
    }));
}

export function mapVisibleColumns(
    columns: Column[]
): {
    visibleColumns: Column[];
    visibleIndexToOriginalIndex: Map<number, number>;
    originalIndexToVisibleIndex: Map<number, number>;
} {
    const visibleColumns: Column[] = [];
    const visibleIndexToOriginalIndex = new Map<number, number>();
    const originalIndexToVisibleIndex = new Map<number, number>();

    columns.forEach((col, originalIndex) => {
        if (col.visible) {
            const visibleIndex = visibleColumns.length;
            visibleIndexToOriginalIndex.set(visibleIndex, originalIndex);
            originalIndexToVisibleIndex.set(originalIndex, visibleIndex);
            visibleColumns.push(col);
        }
    });

    return {
        visibleColumns,
        visibleIndexToOriginalIndex,
        originalIndexToVisibleIndex,
    };
}
