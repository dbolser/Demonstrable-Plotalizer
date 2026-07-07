import { describe, it, expect } from 'vitest';
import {
    ImageDataLRU,
    imageDataBytes,
    totalSnapshotBytes,
    DEFAULT_SNAPSHOT_CAPACITY,
} from '../utils/imageDataCache';

// Lightweight stand-in for ImageData (jsdom's canvas mock has no real one).
// The cache only reads width/height, so this is sufficient and deterministic.
function makeImage(width = 10, height = 10): ImageData {
    return {
        width,
        height,
        data: new Uint8ClampedArray(0),
        colorSpace: 'srgb',
    } as unknown as ImageData;
}

// Mirror of ScatterPlotMatrix's renderKey shape, to exercise realistic keys.
const buildRenderKey = (
    scaleX: string,
    scaleY: string,
    dataStateHash: string,
    selectedStateHash = 'none',
    filterMode = 'highlight',
    size = 150
) => `x-y-${scaleX}-${scaleY}-${filterMode}-${dataStateHash}-${selectedStateHash}-${size}`;

describe('ImageDataLRU', () => {
    it('misses on unknown keys and hits on stored keys', () => {
        const lru = new ImageDataLRU(3);
        const img = makeImage();

        expect(lru.get('a')).toBeUndefined();

        lru.set('a', img);
        expect(lru.get('a')).toBe(img);
        expect(lru.has('a')).toBe(true);
        expect(lru.size).toBe(1);
        expect(lru.bytes).toBe(imageDataBytes(img));
    });

    it('evicts the least-recently-used entry when capacity is exceeded', () => {
        const lru = new ImageDataLRU(3);
        lru.set('a', makeImage());
        lru.set('b', makeImage());
        lru.set('c', makeImage());

        lru.set('d', makeImage());

        expect(lru.size).toBe(3);
        expect(lru.has('a')).toBe(false); // oldest evicted
        expect(lru.keys()).toEqual(['b', 'c', 'd']);
    });

    it('get() promotes an entry so it survives the next eviction', () => {
        const lru = new ImageDataLRU(3);
        lru.set('a', makeImage());
        lru.set('b', makeImage());
        lru.set('c', makeImage());

        // Touch 'a' -> 'b' becomes least-recently-used
        expect(lru.get('a')).toBeDefined();
        lru.set('d', makeImage());

        expect(lru.has('a')).toBe(true);
        expect(lru.has('b')).toBe(false);
        expect(lru.keys()).toEqual(['c', 'a', 'd']);
    });

    it('re-setting an existing key updates the value without growing the cache', () => {
        const lru = new ImageDataLRU(2);
        const first = makeImage(10, 10);
        const second = makeImage(20, 20);

        lru.set('a', first);
        lru.set('b', makeImage());
        lru.set('a', second);

        expect(lru.size).toBe(2);
        expect(lru.peek('a')).toBe(second);
        expect(lru.bytes).toBe(imageDataBytes(second) + imageDataBytes(makeImage()));
        // 'a' was refreshed, so 'b' is now the eviction candidate
        lru.set('c', makeImage());
        expect(lru.has('b')).toBe(false);
        expect(lru.has('a')).toBe(true);
    });

    it('enforces the byte budget by evicting old entries and rejecting oversized ones', () => {
        const entryBytes = imageDataBytes(makeImage(10, 10)); // 400 bytes
        const lru = new ImageDataLRU(10, entryBytes * 2); // room for two entries

        lru.set('a', makeImage(10, 10));
        lru.set('b', makeImage(10, 10));
        lru.set('c', makeImage(10, 10)); // evicts 'a' to stay within budget

        expect(lru.keys()).toEqual(['b', 'c']);
        expect(lru.bytes).toBe(entryBytes * 2);

        // An entry that could never fit is ignored entirely
        lru.set('huge', makeImage(100, 100));
        expect(lru.has('huge')).toBe(false);
        expect(lru.keys()).toEqual(['b', 'c']);
    });

    it('invalidates when the data state hash changes (new renderKey misses, clear() drops old snapshots)', () => {
        const lru = new ImageDataLRU(DEFAULT_SNAPSHOT_CAPACITY);

        const keyOldData = buildRenderKey('linear', 'linear', '100-0-99');
        const keyNewData = buildRenderKey('linear', 'linear', '250-0-249');

        lru.set(keyOldData, makeImage());

        // Same cell + scales but different dataStateHash -> different key, a miss
        expect(lru.get(keyNewData)).toBeUndefined();

        // ScatterPlotMatrix additionally clears all per-cell caches on data
        // change so stale snapshots don't hold memory.
        lru.clear();
        expect(lru.size).toBe(0);
        expect(lru.bytes).toBe(0);
        expect(lru.get(keyOldData)).toBeUndefined();
    });

    it('delete() removes a single entry and its bytes', () => {
        const lru = new ImageDataLRU(3);
        lru.set('a', makeImage());
        lru.set('b', makeImage());

        expect(lru.delete('a')).toBe(true);
        expect(lru.delete('a')).toBe(false);
        expect(lru.has('b')).toBe(true);
        expect(lru.bytes).toBe(imageDataBytes(makeImage()));
    });

    it('totalSnapshotBytes sums across per-cell caches', () => {
        const caches = new Map<string, ImageDataLRU>();
        const a = new ImageDataLRU(6);
        const b = new ImageDataLRU(6);
        a.set('k1', makeImage(10, 10));
        b.set('k2', makeImage(20, 20));
        b.set('k3', makeImage(10, 10));
        caches.set('colA-colB', a);
        caches.set('colB-colC', b);

        expect(totalSnapshotBytes(caches)).toBe(
            imageDataBytes(makeImage(10, 10)) * 2 + imageDataBytes(makeImage(20, 20))
        );
    });
});
