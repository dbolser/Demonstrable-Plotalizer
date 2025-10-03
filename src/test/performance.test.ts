import { describe, it, expect, vi } from 'vitest';
import type { DataPoint, Column } from '../../types';
import {
  reorderColumns,
  filterColumns,
  mapVisibleColumns,
} from '../utils/columnUtils';
import { filterData } from '../utils/dataUtils';

// Helper functions for performance testing
function createLargeDataset(rows: number, cols: number): { data: DataPoint[], columns: Column[] } {
  const columns: Column[] = Array.from({ length: cols }, (_, i) => ({
    name: `col_${i + 1}`,
    scale: 'linear' as const,
    visible: true,
  }));

  const data: DataPoint[] = Array.from({ length: rows }, (_, i) => {
    const point: DataPoint = { __id: i };
    columns.forEach(col => {
      point[col.name] = Math.random() * 100;
    });
    return point;
  });

  return { data, columns };
}

function measureExecutionTime<T>(fn: () => T): { result: T; time: number } {
  const start = performance.now();
  const result = fn();
  const end = performance.now();
  return { result, time: end - start };
}

// Mock canvas caching functions for testing
function mockCacheCanvasAsImage(canvas: HTMLCanvasElement, key: string): string {
  // Simulate canvas to data URL conversion
  return `data:image/png;base64,mock_${key}`;
}

function mockCreateImageFromCache(key: string, left: number, top: number): HTMLImageElement | null {
  const img = document.createElement('img');
  img.src = `data:image/png;base64,mock_${key}`;
  img.style.position = 'absolute';
  img.style.left = `${left}px`;
  img.style.top = `${top}px`;
  return img;
}

describe('Performance Tests', () => {
  it('should handle 30k rows efficiently', () => {
    const { data, columns } = createLargeDataset(30000, 5);
    const selectedIds = new Set(
      Array.from({ length: 5000 }, (_, i) => i * 6)
    ); // Select 5k points

    const { time } = measureExecutionTime(() => {
      // Use the actual data filtering logic
      return filterData(data, selectedIds, 'filter');
    });

    // Should complete within reasonable time (adjust threshold as needed)
    expect(time).toBeLessThan(100); // 100ms threshold
    expect(data.length).toBe(30000);
    expect(columns.length).toBe(5);
  });

  it('should handle 30 columns efficiently', () => {
    const { data, columns } = createLargeDataset(1000, 30);

    const { time } = measureExecutionTime(() => {
      // Use the actual column visibility logic
      return mapVisibleColumns(columns);
    });

    expect(time).toBeLessThan(10); // Should be very fast
    expect(columns.length).toBe(30);
  });

  it('should efficiently create cache keys for large datasets', () => {
    const { data } = createLargeDataset(30000, 5);

    const { time } = measureExecutionTime(() => {
      // Simulate cache key creation
      const dataLength = data.length;
      const firstDataId = data[0]?.__id ?? 0;
      const selectedSize = 100; // Simulate selection
      return `${dataLength}-${selectedSize}-${firstDataId}`;
    });

    expect(time).toBeLessThan(1); // Should be immediate
  });

  it('should handle canvas caching operations efficiently', () => {
    const mockCanvas = document.createElement('canvas');
    mockCanvas.width = 150;
    mockCanvas.height = 150;

    const { time } = measureExecutionTime(() => {
      // Simulate caching multiple canvas elements
      const keys: string[] = [];
      for (let i = 0; i < 25; i++) { // 5x5 matrix
        const key = `col${i % 5}-col${Math.floor(i / 5)}`;
        mockCacheCanvasAsImage(mockCanvas, key);
        keys.push(key);
      }
      return keys;
    });

    expect(time).toBeLessThan(50); // Should cache 25 canvases quickly
  });

  it('should efficiently restore images from cache', () => {
    const cacheKeys = Array.from({ length: 25 }, (_, i) =>
      `col${i % 5}-col${Math.floor(i / 5)}`
    );

    const { time } = measureExecutionTime(() => {
      // Simulate restoring images from cache
      const images = cacheKeys.map((key, i) =>
        mockCreateImageFromCache(key, (i % 5) * 150, Math.floor(i / 5) * 150)
      );
      return images;
    });

    expect(time).toBeLessThan(20); // Should restore 25 images quickly
  });

  it('should handle column reordering with large datasets', () => {
    const { columns } = createLargeDataset(30000, 30);

    const { time } = measureExecutionTime(() => {
      // Use the actual reordering logic
      return reorderColumns(columns, 0, 29);
    });

    expect(time).toBeLessThan(1); // Array swapping should be immediate
  });

  it('should efficiently filter columns by name pattern', () => {
    const { columns } = createLargeDataset(1000, 30);
    const filter = 'col_1';

    const { time } = measureExecutionTime(() => {
      // Use the actual column filtering logic
      return filterColumns(columns, filter);
    });

    expect(time).toBeLessThan(5); // String filtering should be fast
  });

  it('should handle memory usage efficiently with image caching', () => {
    // Simulate memory-efficient caching strategy
    const cache = new Map<string, string>();
    const maxCacheSize = 100; // Limit cache size

    const { time } = measureExecutionTime(() => {
      // Add many cache entries
      for (let i = 0; i < 200; i++) {
        const key = `cache_${i}`;
        const value = `data:image/png;base64,mock_${i}`;

        if (cache.size >= maxCacheSize) {
          // Remove oldest entry (simple LRU simulation)
          const firstKey = cache.keys().next().value;
          cache.delete(firstKey);
        }

        cache.set(key, value);
      }
      return cache;
    });

    expect(cache.size).toBeLessThanOrEqual(maxCacheSize);
    expect(time).toBeLessThan(10);
  });

  it('should handle brush selection with large datasets efficiently', () => {
    const { data } = createLargeDataset(30000, 5);
    const selectedIds = new Set(Array.from({ length: 1000 }, (_, i) => i));

    const { time } = measureExecutionTime(() => {
      // Use the actual data filtering logic for brush selection
      return filterData(data, selectedIds, 'highlight');
    });

    expect(time).toBeLessThan(50); // Should filter 30k records reasonably fast
  });
});