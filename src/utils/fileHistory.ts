const DB_NAME = 'PlotalizerHistory';
const DB_VERSION = 1;
const STORE_NAME = 'files';
const MAX_ENTRIES = 5;
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

export interface FileHistoryEntry {
    id?: number;
    filename: string;
    timestamp: number;
    csvText: string;
}

function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export async function saveFile(filename: string, csvText: string): Promise<void> {
    if (csvText.length > MAX_FILE_SIZE) {
        console.warn('File too large to save to history (>50 MB).');
        return;
    }

    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    // Get all existing entries to enforce the limit
    const allEntries = await new Promise<FileHistoryEntry[]>((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });

    // Remove oldest entries if over limit (keep MAX_ENTRIES - 1 so we can add one more)
    const sorted = [...allEntries].sort((a, b) => a.timestamp - b.timestamp);
    while (sorted.length >= MAX_ENTRIES) {
        const oldest = sorted.shift();
        if (oldest?.id !== undefined) {
            store.delete(oldest.id);
        }
    }

    // Also remove any existing entry with the same filename (update it)
    for (const entry of allEntries) {
        if (entry.filename === filename && entry.id !== undefined) {
            store.delete(entry.id);
        }
    }

    store.add({ filename, timestamp: Date.now(), csvText });

    await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export async function getHistory(): Promise<FileHistoryEntry[]> {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);

        const entries = await new Promise<FileHistoryEntry[]>((resolve, reject) => {
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });

        // Return sorted by most recent first
        return entries.sort((a, b) => b.timestamp - a.timestamp);
    } catch (err) {
        console.error('Failed to retrieve file history:', err);
        return [];
    }
}

export async function deleteEntry(id: number): Promise<void> {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

/** Format a timestamp as a relative time string like "2 hours ago". */
export function formatRelativeTime(timestamp: number): string {
    const diffMs = Date.now() - timestamp;
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return 'just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? 's' : ''} ago`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour} hour${diffHour !== 1 ? 's' : ''} ago`;
    const diffDay = Math.floor(diffHour / 24);
    return `${diffDay} day${diffDay !== 1 ? 's' : ''} ago`;
}
