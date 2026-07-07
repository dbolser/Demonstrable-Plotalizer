import { describe, it, expect } from 'vitest';
import Papa from 'papaparse';
import { detectColumnTypes } from '../utils/columnTypeUtils';
import { cellValueToNumber, isFiniteCellValue } from '../utils/cellValueUtils';

describe('detectColumnTypes', () => {
  it('detects numeric columns whose leading rows are empty (sparse PCA-style file)', () => {
    // Mirrors the reported bug: PC columns blank for the first rows.
    const csv = [
      'name,PC1,PC2',
      'a,,',
      'b,,',
      'c,-0.00277396,-0.0194201',
      'd,3.97848e-05,-0.0138617',
    ].join('\n');
    const result = Papa.parse(csv, { header: true, dynamicTyping: true, skipEmptyLines: true });
    const rows = result.data as Record<string, number | string | null>[];

    const detected = detectColumnTypes(rows, result.meta.fields);
    expect(detected.numericColumns).toEqual(['PC1', 'PC2']);
    expect(detected.stringColumns).toEqual(['name']);
    expect(detected.emptyColumns).toEqual([]);
  });

  it('classifies by evidence across all rows, not row 0', () => {
    const rows = [
      { label: null, sparse: null, empty: null, mixed: null },
      { label: 'x', sparse: 42, empty: null, mixed: 1 },
      { label: 'y', sparse: null, empty: null, mixed: 'oops' },
    ];
    const detected = detectColumnTypes(rows);
    expect(detected.numericColumns).toEqual(['sparse']);
    expect(detected.stringColumns).toEqual(['label', 'mixed']); // any real text wins
    expect(detected.emptyColumns).toEqual(['empty']);
  });

  it('ignores __id and handles empty input', () => {
    expect(detectColumnTypes([])).toEqual({ numericColumns: [], stringColumns: [], emptyColumns: [] });
    const detected = detectColumnTypes([{ __id: 0, a: 1 }]);
    expect(detected.numericColumns).toEqual(['a']);
  });
});

describe('cellValueToNumber', () => {
  it('yields NaN for missing/blank cells instead of 0', () => {
    expect(cellValueToNumber(null)).toBeNaN();
    expect(cellValueToNumber(undefined)).toBeNaN();
    expect(cellValueToNumber('')).toBeNaN();
    expect(cellValueToNumber('  ')).toBeNaN();
    expect(cellValueToNumber('abc')).toBeNaN();
  });

  it('passes real numbers through, including genuine zeros', () => {
    expect(cellValueToNumber(0)).toBe(0);
    expect(cellValueToNumber('0')).toBe(0);
    expect(cellValueToNumber('3.97848e-05')).toBeCloseTo(3.97848e-5);
    expect(cellValueToNumber(-0.00277396)).toBeCloseTo(-0.00277396);
  });

  it('agrees with isFiniteCellValue', () => {
    for (const v of [null, undefined, '', ' ', 'x', 0, '0', 1.5, '2e3']) {
      expect(Number.isFinite(cellValueToNumber(v))).toBe(isFiniteCellValue(v));
    }
  });
});
