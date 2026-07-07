import { describe, it, expect } from 'vitest';
import { isSupportedDataFile } from '../../components/FileUpload';

describe('isSupportedDataFile', () => {
  it('accepts csv, tsv, tab and txt extensions case-insensitively', () => {
    expect(isSupportedDataFile('data.csv')).toBe(true);
    expect(isSupportedDataFile('data.tsv')).toBe(true);
    expect(isSupportedDataFile('data.tab')).toBe(true);
    expect(isSupportedDataFile('data.txt')).toBe(true);
    expect(isSupportedDataFile('DATA.TSV')).toBe(true);
    expect(isSupportedDataFile('archive.2026.csv')).toBe(true);
  });

  it('rejects other extensions and extensionless names', () => {
    expect(isSupportedDataFile('data.xlsx')).toBe(false);
    expect(isSupportedDataFile('data.json')).toBe(false);
    expect(isSupportedDataFile('data.csv.gz')).toBe(false);
    expect(isSupportedDataFile('data')).toBe(false);
    expect(isSupportedDataFile('csv')).toBe(false);
  });
});
