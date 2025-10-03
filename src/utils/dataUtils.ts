import type { DataPoint, FilterMode } from '../types';

export function filterData(
    data: DataPoint[],
    selectedIds: Set<number>,
    filterMode: FilterMode
): { filteredData: DataPoint[]; selectedData: DataPoint[] } {
    const selectedData = data.filter(d => selectedIds.has(d.__id));
    if (filterMode === 'filter' && selectedIds.size > 0) {
        return { filteredData: selectedData, selectedData };
    }
    return { filteredData: data, selectedData };
}
