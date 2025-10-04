import type { Column } from '../types';

export function reorderColumns(columns: Column[], dragIndex: number, hoverIndex: number): Column[] {
    const newColumns = [...columns];
    [newColumns[dragIndex], newColumns[hoverIndex]] = [newColumns[hoverIndex], newColumns[dragIndex]];
    return newColumns;
}

export function sortColumnsByVisibility(columns: Column[]): Column[] {
    const visible: Column[] = [];
    const hidden: Column[] = [];

    columns.forEach(col => {
        if (col.visible) {
            visible.push(col);
        } else {
            hidden.push(col);
        }
    });

    const sorted = [...visible, ...hidden];
    for (let i = 0; i < columns.length; i++) {
        if (columns[i] !== sorted[i]) {
            return sorted;
        }
    }

    return columns;
}

export function filterColumns(columns: Column[], filter: string): Column[] {
    const normalizedFilter = filter.trim().toLowerCase();
    const shouldShowAll = normalizedFilter === '';

    let didChange = false;
    const nextColumns: Column[] = new Array(columns.length);

    for (let index = 0; index < columns.length; index++) {
        const col = columns[index];
        const shouldBeVisible = shouldShowAll || col.name.toLowerCase().includes(normalizedFilter);

        if (col.visible === shouldBeVisible) {
            nextColumns[index] = col;
        } else {
            didChange = true;
            nextColumns[index] = { ...col, visible: shouldBeVisible };
        }
    }

    const updatedColumns = didChange ? nextColumns : columns;
    return sortColumnsByVisibility(updatedColumns);
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
