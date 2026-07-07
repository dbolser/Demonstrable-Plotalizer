import { describe, it, expect, afterEach, vi } from 'vitest';
import { isValidDataUrl, getDataUrlFromQuery, looksLikeHtml, fetchCsvFromUrl } from '../utils/urlLoader';

describe('urlLoader', () => {
  describe('isValidDataUrl', () => {
    it('accepts http and https URLs', () => {
      expect(isValidDataUrl('https://example.com/data.csv')).toBe(true);
      expect(isValidDataUrl('http://example.com/data.tsv')).toBe(true);
      expect(isValidDataUrl('https://example.com/path/file.csv?token=abc')).toBe(true);
    });

    it('rejects non-http(s) protocols', () => {
      expect(isValidDataUrl('ftp://example.com/data.csv')).toBe(false);
      expect(isValidDataUrl('file:///etc/passwd')).toBe(false);
      expect(isValidDataUrl('javascript:alert(1)')).toBe(false);
    });

    it('rejects malformed strings', () => {
      expect(isValidDataUrl('')).toBe(false);
      expect(isValidDataUrl('not a url')).toBe(false);
      expect(isValidDataUrl('example.com/data.csv')).toBe(false);
    });
  });

  describe('getDataUrlFromQuery', () => {
    it('extracts the data parameter', () => {
      expect(getDataUrlFromQuery('?data=https://example.com/data.csv'))
        .toBe('https://example.com/data.csv');
    });

    it('decodes URL-encoded values', () => {
      expect(getDataUrlFromQuery('?data=https%3A%2F%2Fexample.com%2Fmy%20data.csv'))
        .toBe('https://example.com/my data.csv');
    });

    it('handles other parameters alongside data', () => {
      expect(getDataUrlFromQuery('?foo=bar&data=https://example.com/d.tsv&baz=1'))
        .toBe('https://example.com/d.tsv');
    });

    it('returns null when absent or empty', () => {
      expect(getDataUrlFromQuery('')).toBeNull();
      expect(getDataUrlFromQuery('?foo=bar')).toBeNull();
      expect(getDataUrlFromQuery('?data=')).toBeNull();
      expect(getDataUrlFromQuery('?data=%20%20')).toBeNull();
    });

    it('trims surrounding whitespace', () => {
      expect(getDataUrlFromQuery('?data=%20https://example.com/data.csv%20'))
        .toBe('https://example.com/data.csv');
    });
  });

  describe('looksLikeHtml', () => {
    it('detects HTML documents', () => {
      expect(looksLikeHtml('<!DOCTYPE html><html><body>404</body></html>')).toBe(true);
      expect(looksLikeHtml('  \n<html lang="en"><head></head></html>')).toBe(true);
    });

    it('does not flag CSV or TSV content', () => {
      expect(looksLikeHtml('a,b,c\n1,2,3')).toBe(false);
      expect(looksLikeHtml('a\tb\tc\n1\t2\t3')).toBe(false);
      expect(looksLikeHtml('name,desc\nfoo,"uses <html> tags"')).toBe(false);
    });
  });

  describe('fetchCsvFromUrl', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const mockFetch = (impl: () => Promise<unknown>) => {
      const fn = vi.fn(impl);
      vi.stubGlobal('fetch', fn);
      return fn;
    };

    it('returns the response text for a successful fetch', async () => {
      mockFetch(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => 'a,b\n1,2',
      }));
      await expect(fetchCsvFromUrl('https://example.com/data.csv')).resolves.toBe('a,b\n1,2');
    });

    it('rejects invalid URLs without fetching', async () => {
      const fn = mockFetch(async () => { throw new Error('should not be called'); });
      await expect(fetchCsvFromUrl('not a url')).rejects.toThrow(/not a valid/);
      expect(fn).not.toHaveBeenCalled();
    });

    it('reports network/CORS failures with a friendly message', async () => {
      mockFetch(async () => { throw new TypeError('Failed to fetch'); });
      await expect(fetchCsvFromUrl('https://example.com/data.csv'))
        .rejects.toThrow(/CORS/);
    });

    it('reports non-2xx responses', async () => {
      mockFetch(async () => ({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => '',
      }));
      await expect(fetchCsvFromUrl('https://example.com/missing.csv'))
        .rejects.toThrow(/404 Not Found/);
    });

    it('rejects empty responses', async () => {
      mockFetch(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => '   \n  ',
      }));
      await expect(fetchCsvFromUrl('https://example.com/empty.csv'))
        .rejects.toThrow(/empty/);
    });

    it('rejects HTML responses with a hint about raw URLs', async () => {
      mockFetch(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => '<!DOCTYPE html><html><body>Not CSV</body></html>',
      }));
      await expect(fetchCsvFromUrl('https://github.com/user/repo/blob/main/data.csv'))
        .rejects.toThrow(/HTML page/);
    });
  });
});
