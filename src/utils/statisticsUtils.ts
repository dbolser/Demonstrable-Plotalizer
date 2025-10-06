import type { DataPoint } from '../../types';

export interface ColumnCacheEntry {
    finiteValues: number[];
    min: number;
    max: number;
    minPositive: number;
}

export function computeColumnCaches(data: DataPoint[], columnNames: string[]): Map<string, ColumnCacheEntry> {
    const caches = new Map<string, ColumnCacheEntry>();
    if (data.length === 0 || columnNames.length === 0) {
        return caches;
    }

    for (const name of columnNames) {
        let min = Infinity;
        let max = -Infinity;
        let minPositive = Infinity;
        const finiteValues: number[] = [];

        for (let i = 0; i < data.length; i++) {
            const value = Number(data[i][name]);
            if (!Number.isFinite(value)) {
                continue;
            }

            finiteValues.push(value);
            if (value < min) min = value;
            if (value > max) max = value;
            if (value > 0 && value < minPositive) minPositive = value;
        }

        if (!Number.isFinite(min)) min = 0;
        if (!Number.isFinite(max)) max = 1;
        if (!Number.isFinite(minPositive)) {
            const fallback = max > 0 ? max : 1;
            minPositive = fallback > 0 ? fallback : 1e-9;
        }
        if (min === max) {
            min = min - 1;
            max = max + 1;
        }

        caches.set(name, {
            finiteValues,
            min,
            max,
            minPositive,
        });
    }

    return caches;
}

export function computeStatsForSubset(rows: DataPoint[], columnNames: string[]): Map<string, { min: number; max: number; minPositive: number }> {
    const stats = new Map<string, { min: number; max: number; minPositive: number }>();
    if (rows.length === 0 || columnNames.length === 0) {
        columnNames.forEach(name => {
            stats.set(name, { min: 0, max: 1, minPositive: 1 });
        });
        return stats;
    }

    for (const name of columnNames) {
        let min = Infinity;
        let max = -Infinity;
        let minPositive = Infinity;

        for (const row of rows) {
            const value = Number(row[name]);
            if (!Number.isFinite(value)) continue;
            if (value < min) min = value;
            if (value > max) max = value;
            if (value > 0 && value < minPositive) minPositive = value;
        }

        if (!Number.isFinite(min)) min = 0;
        if (!Number.isFinite(max)) max = 1;
        if (!Number.isFinite(minPositive)) {
            const fallback = max > 0 ? max : 1;
            minPositive = fallback > 0 ? fallback : 1e-9;
        }
        if (min === max) {
            min = min - 1;
            max = max + 1;
        }

        stats.set(name, { min, max, minPositive });
    }

    return stats;
}
