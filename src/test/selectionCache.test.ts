import { describe, it, expect } from 'vitest';
import { computeSelectedStateHash } from '../../components/ScatterPlotMatrix';

const buildCacheKey = (selectedIds: Set<number>) =>
  `x-y-linear-linear-data-${computeSelectedStateHash(selectedIds)}-highlight`;

describe('selected state cache key stability', () => {
  it('updates cache keys when selection membership changes', () => {
    const initialSelection = new Set([1, 2, 3, 4, 5, 6]);
    const updatedSelection = new Set([1, 2, 3, 4, 5, 42]);

    const initialKey = buildCacheKey(initialSelection);
    const updatedKey = buildCacheKey(updatedSelection);

    expect(initialKey).not.toEqual(updatedKey);
  });

  it('produces stable cache keys for identical selections regardless of order', () => {
    const selectionA = new Set([7, 3, 11, 5]);
    const selectionB = new Set<number>();
    [5, 11, 3, 7].forEach(id => selectionB.add(id));

    expect(buildCacheKey(selectionA)).toEqual(buildCacheKey(selectionB));
  });
});
