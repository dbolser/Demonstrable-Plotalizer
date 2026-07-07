/**
 * Small LRU cache of canvas ImageData snapshots, keyed by render key.
 *
 * Used by ScatterPlotMatrix to restore previously-seen cell configurations
 * (e.g. toggling a column's log scale back and forth) via `putImageData`
 * instead of re-plotting every point. One instance per canvas cell.
 *
 * A Map's insertion order doubles as the recency order: `get` re-inserts the
 * entry (most-recently-used at the end), and eviction removes the first key
 * (least-recently-used).
 */

export const DEFAULT_SNAPSHOT_CAPACITY = 6;

export function imageDataBytes(image: ImageData): number {
    // RGBA: 4 bytes per pixel
    return image.width * image.height * 4;
}

export class ImageDataLRU {
    private entries = new Map<string, ImageData>();
    private totalBytes = 0;

    constructor(
        private readonly capacity: number = DEFAULT_SNAPSHOT_CAPACITY,
        private readonly maxBytes: number = Infinity
    ) { }

    get size(): number {
        return this.entries.size;
    }

    get bytes(): number {
        return this.totalBytes;
    }

    /** Look up a snapshot and promote it to most-recently-used. */
    get(key: string): ImageData | undefined {
        const value = this.entries.get(key);
        if (value === undefined) return undefined;
        this.entries.delete(key);
        this.entries.set(key, value);
        return value;
    }

    /** Look up without affecting recency (useful for tests/diagnostics). */
    peek(key: string): ImageData | undefined {
        return this.entries.get(key);
    }

    has(key: string): boolean {
        return this.entries.has(key);
    }

    /**
     * Store a snapshot, evicting least-recently-used entries as needed to
     * stay within both the entry-count capacity and the byte budget.
     * Entries that could never fit are silently ignored.
     */
    set(key: string, image: ImageData): void {
        const bytes = imageDataBytes(image);
        if (bytes > this.maxBytes || this.capacity < 1) return;

        const existing = this.entries.get(key);
        if (existing !== undefined) {
            this.totalBytes -= imageDataBytes(existing);
            this.entries.delete(key);
        }

        this.entries.set(key, image);
        this.totalBytes += bytes;

        while (this.entries.size > this.capacity || this.totalBytes > this.maxBytes) {
            const oldestKey = this.entries.keys().next().value as string;
            const oldest = this.entries.get(oldestKey)!;
            this.totalBytes -= imageDataBytes(oldest);
            this.entries.delete(oldestKey);
        }
    }

    delete(key: string): boolean {
        const existing = this.entries.get(key);
        if (existing === undefined) return false;
        this.totalBytes -= imageDataBytes(existing);
        return this.entries.delete(key);
    }

    clear(): void {
        this.entries.clear();
        this.totalBytes = 0;
    }

    /** Keys in least-recently-used -> most-recently-used order. */
    keys(): string[] {
        return Array.from(this.entries.keys());
    }
}

/** Sum of snapshot bytes across a collection of per-cell caches. */
export function totalSnapshotBytes(caches: Map<string, ImageDataLRU>): number {
    let total = 0;
    caches.forEach(cache => {
        total += cache.bytes;
    });
    return total;
}
