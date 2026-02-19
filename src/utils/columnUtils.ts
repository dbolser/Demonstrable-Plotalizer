import type { Column } from '../../types';

export function reorderColumns(columns: Column[], dragIndex: number, hoverIndex: number): Column[] {
    const newColumns = [...columns];
    [newColumns[dragIndex], newColumns[hoverIndex]] = [newColumns[hoverIndex], newColumns[dragIndex]];
    return newColumns;
}

export function filterColumns(columns: Column[], filter: string): Column[] {
    const normalizedFilter = filter.trim().toLowerCase();

    // When filter is empty, return columns unchanged (preserves manual visibility state)
    if (normalizedFilter === '') {
        return columns;
    }

    // B2: Split by comma for OR logic; B5: AND with existing visibility
    const terms = normalizedFilter.split(',').map(t => t.trim()).filter(Boolean);

    // If splitting yields no actual terms (e.g. input is only commas/whitespace),
    // treat this as an empty filter and return columns unchanged.
    if (terms.length === 0) {
        return columns;
    }
    let didChange = false;
    const nextColumns: Column[] = new Array(columns.length);

    for (let index = 0; index < columns.length; index++) {
        const col = columns[index];
        const matchesFilter = terms.some(term => col.name.toLowerCase().includes(term));
        // Filter is additive on top of manual visibility state
        const shouldBeVisible = matchesFilter;

        if (col.visible === shouldBeVisible) {
            nextColumns[index] = col;
        } else {
            didChange = true;
            nextColumns[index] = { ...col, visible: shouldBeVisible };
        }
    }

    return didChange ? nextColumns : columns;
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
