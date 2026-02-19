import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { saveFile, getHistory, deleteEntry, formatRelativeTime } from '../utils/fileHistory';

describe('fileHistory', () => {
  beforeEach(() => {
    // Reset indexedDB before each test
    indexedDB = new IDBFactory();
  });

  afterEach(() => {
    // Clean up
    indexedDB = new IDBFactory();
  });

  describe('saveFile', () => {
    it('saves a file to history', async () => {
      await saveFile('test.csv', 'col1,col2\n1,2\n3,4');
      const history = await getHistory();
      
      expect(history).toHaveLength(1);
      expect(history[0].filename).toBe('test.csv');
      expect(history[0].csvText).toBe('col1,col2\n1,2\n3,4');
      expect(history[0].timestamp).toBeDefined();
    });

    it('enforces MAX_ENTRIES limit (5 entries)', async () => {
      // Add 6 files
      for (let i = 0; i < 6; i++) {
        await saveFile(`file${i}.csv`, `data${i}`);
        // Add small delay to ensure different timestamps
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      const history = await getHistory();
      
      // Should only have 5 entries (MAX_ENTRIES)
      expect(history).toHaveLength(5);
      
      // First file (file0.csv) should be removed, newest should remain
      const filenames = history.map(entry => entry.filename);
      expect(filenames).not.toContain('file0.csv');
      expect(filenames).toContain('file5.csv');
      expect(filenames).toContain('file4.csv');
      expect(filenames).toContain('file3.csv');
      expect(filenames).toContain('file2.csv');
      expect(filenames).toContain('file1.csv');
    });

    it('replaces existing entry with same filename (deduping)', async () => {
      await saveFile('test.csv', 'original data');
      await new Promise(resolve => setTimeout(resolve, 10));
      await saveFile('test.csv', 'updated data');

      const history = await getHistory();
      
      // Should only have 1 entry
      expect(history).toHaveLength(1);
      expect(history[0].filename).toBe('test.csv');
      expect(history[0].csvText).toBe('updated data');
    });

    it('does not save files larger than 50 MB', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      // Create a string larger than 50 MB
      const largeData = 'x'.repeat(51 * 1024 * 1024);
      
      await saveFile('large.csv', largeData);
      const history = await getHistory();
      
      expect(history).toHaveLength(0);
      expect(consoleSpy).toHaveBeenCalledWith('File too large to save to history (>50 MB).');
      
      consoleSpy.mockRestore();
    });
  });

  describe('getHistory', () => {
    it('returns empty array when no history exists', async () => {
      const history = await getHistory();
      expect(history).toEqual([]);
    });

    it('returns entries sorted by most recent first', async () => {
      // Add multiple files with delays to ensure different timestamps
      await saveFile('file1.csv', 'data1');
      await new Promise(resolve => setTimeout(resolve, 10));
      await saveFile('file2.csv', 'data2');
      await new Promise(resolve => setTimeout(resolve, 10));
      await saveFile('file3.csv', 'data3');

      const history = await getHistory();
      
      expect(history).toHaveLength(3);
      expect(history[0].filename).toBe('file3.csv'); // Most recent
      expect(history[1].filename).toBe('file2.csv');
      expect(history[2].filename).toBe('file1.csv'); // Oldest
      
      // Verify timestamps are in descending order
      expect(history[0].timestamp).toBeGreaterThanOrEqual(history[1].timestamp);
      expect(history[1].timestamp).toBeGreaterThanOrEqual(history[2].timestamp);
    });

    it('handles errors gracefully and returns empty array', async () => {
      // Save some data first
      await saveFile('test.csv', 'data');
      
      // Break indexedDB by setting it to an invalid value
      const originalIndexedDB = indexedDB;
      (globalThis as any).indexedDB = undefined;
      
      const history = await getHistory();
      expect(history).toEqual([]);
      
      // Restore indexedDB
      (globalThis as any).indexedDB = originalIndexedDB;
    });
  });

  describe('deleteEntry', () => {
    it('deletes an entry by id', async () => {
      await saveFile('file1.csv', 'data1');
      await saveFile('file2.csv', 'data2');
      await saveFile('file3.csv', 'data3');

      let history = await getHistory();
      expect(history).toHaveLength(3);
      
      // Delete the middle entry
      const idToDelete = history[1].id!;
      await deleteEntry(idToDelete);

      history = await getHistory();
      expect(history).toHaveLength(2);
      expect(history.find(e => e.id === idToDelete)).toBeUndefined();
    });

    it('does nothing if id does not exist', async () => {
      await saveFile('test.csv', 'data');
      
      // Try to delete a non-existent id
      await deleteEntry(999);
      
      const history = await getHistory();
      expect(history).toHaveLength(1);
    });
  });

  describe('formatRelativeTime', () => {
    it('returns "just now" for times less than 60 seconds ago', () => {
      const now = Date.now();
      expect(formatRelativeTime(now)).toBe('just now');
      expect(formatRelativeTime(now - 30 * 1000)).toBe('just now');
      expect(formatRelativeTime(now - 59 * 1000)).toBe('just now');
    });

    it('returns minutes for times less than 60 minutes ago', () => {
      const now = Date.now();
      expect(formatRelativeTime(now - 60 * 1000)).toBe('1 minute ago');
      expect(formatRelativeTime(now - 120 * 1000)).toBe('2 minutes ago');
      expect(formatRelativeTime(now - 30 * 60 * 1000)).toBe('30 minutes ago');
      expect(formatRelativeTime(now - 59 * 60 * 1000)).toBe('59 minutes ago');
    });

    it('returns hours for times less than 24 hours ago', () => {
      const now = Date.now();
      expect(formatRelativeTime(now - 60 * 60 * 1000)).toBe('1 hour ago');
      expect(formatRelativeTime(now - 2 * 60 * 60 * 1000)).toBe('2 hours ago');
      expect(formatRelativeTime(now - 23 * 60 * 60 * 1000)).toBe('23 hours ago');
    });

    it('returns days for times 24 hours or more ago', () => {
      const now = Date.now();
      expect(formatRelativeTime(now - 24 * 60 * 60 * 1000)).toBe('1 day ago');
      expect(formatRelativeTime(now - 2 * 24 * 60 * 60 * 1000)).toBe('2 days ago');
      expect(formatRelativeTime(now - 7 * 24 * 60 * 60 * 1000)).toBe('7 days ago');
    });
  });

  describe('integration scenarios', () => {
    it('maintains correct state when replacing and enforcing limits', async () => {
      // Add 4 files
      for (let i = 0; i < 4; i++) {
        await saveFile(`file${i}.csv`, `data${i}`);
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      let history = await getHistory();
      expect(history).toHaveLength(4);

      // Update an existing file (should not change count)
      await saveFile('file2.csv', 'updated data');
      history = await getHistory();
      expect(history).toHaveLength(4);
      
      // The updated file should be the most recent
      expect(history[0].filename).toBe('file2.csv');
      expect(history[0].csvText).toBe('updated data');

      // Add new files until we exceed the limit
      await saveFile('file4.csv', 'data4');
      history = await getHistory();
      expect(history).toHaveLength(5);

      // Add one more (should remove oldest)
      await saveFile('file5.csv', 'data5');
      history = await getHistory();
      expect(history).toHaveLength(5);
      
      const filenames = history.map(e => e.filename);
      expect(filenames).not.toContain('file0.csv'); // Oldest removed
      expect(filenames).toContain('file5.csv'); // New file added
    });

    it('handles mixed operations correctly', async () => {
      // Add files
      await saveFile('a.csv', 'data_a');
      await new Promise(resolve => setTimeout(resolve, 10));
      await saveFile('b.csv', 'data_b');
      await new Promise(resolve => setTimeout(resolve, 10));
      await saveFile('c.csv', 'data_c');

      let history = await getHistory();
      expect(history).toHaveLength(3);

      // Delete one
      const idToDelete = history.find(e => e.filename === 'b.csv')!.id!;
      await deleteEntry(idToDelete);

      history = await getHistory();
      expect(history).toHaveLength(2);

      // Update one
      await saveFile('a.csv', 'data_a_updated');

      history = await getHistory();
      expect(history).toHaveLength(2);
      expect(history.find(e => e.filename === 'a.csv')!.csvText).toBe('data_a_updated');
    });
  });
});
