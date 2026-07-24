import { describe, it, expect } from 'vitest';
import {
  computeSampleDefaults,
  SAMPLE_CATEGORY_COLUMN,
} from '../utils/sampleDefaults';
import type { SampleDefaultsContext } from '../utils/sampleDefaults';

// The iris sample's string columns as detected by detectColumnTypes.
const IRIS_STRING_COLUMNS = ['species'];

const sampleContext = (overrides: Partial<SampleDefaultsContext> = {}): SampleDefaultsContext => ({
  isSample: true,
  hasPendingViewState: false,
  stringColumns: IRIS_STRING_COLUMNS,
  ...overrides,
});

describe('computeSampleDefaults', () => {
  it('exports the expected sample category column', () => {
    expect(SAMPLE_CATEGORY_COLUMN).toBe('species');
  });

  describe('sample dataset (normal case)', () => {
    it('returns the full colorful defaults for the iris sample', () => {
      expect(computeSampleDefaults(sampleContext())).toEqual({
        colorMode: 'category',
        categoryColorColumn: 'species',
        tintCellBorders: true,
        showRegressionLine: true,
      });
    });

    it('finds species among multiple string columns regardless of position', () => {
      const result = computeSampleDefaults(
        sampleContext({ stringColumns: ['label', 'species', 'notes'] })
      );
      expect(result?.colorMode).toBe('category');
      expect(result?.categoryColorColumn).toBe('species');
    });
  });

  describe('non-sample loads keep neutral defaults', () => {
    it('returns null for uploaded / history / URL data even with a species column', () => {
      expect(computeSampleDefaults(sampleContext({ isSample: false }))).toBeNull();
    });

    it('returns null for non-sample data with no string columns', () => {
      expect(
        computeSampleDefaults(sampleContext({ isSample: false, stringColumns: [] }))
      ).toBeNull();
    });
  });

  describe('pending shared view state wins', () => {
    it('returns null when a #view= state is pending, even for the sample', () => {
      expect(
        computeSampleDefaults(sampleContext({ hasPendingViewState: true }))
      ).toBeNull();
    });

    it('returns null when both non-sample and pending view apply', () => {
      expect(
        computeSampleDefaults(sampleContext({ isSample: false, hasPendingViewState: true }))
      ).toBeNull();
    });
  });

  describe('sample without a species column (edge case)', () => {
    it('still applies border tint and regression lines but not category coloring', () => {
      expect(computeSampleDefaults(sampleContext({ stringColumns: [] }))).toEqual({
        colorMode: 'none',
        categoryColorColumn: null,
        tintCellBorders: true,
        showRegressionLine: true,
      });
    });

    it('does not fall back to a different string column', () => {
      const result = computeSampleDefaults(
        sampleContext({ stringColumns: ['variety', 'label'] })
      );
      expect(result?.colorMode).toBe('none');
      expect(result?.categoryColorColumn).toBeNull();
    });

    it('matches by exact name, not case-insensitively', () => {
      const result = computeSampleDefaults(sampleContext({ stringColumns: ['Species'] }));
      expect(result?.categoryColorColumn).toBeNull();
      expect(result?.colorMode).toBe('none');
    });
  });

  it('is pure: does not mutate the context it is given', () => {
    const context = sampleContext();
    const stringColumnsBefore = [...context.stringColumns];
    computeSampleDefaults(context);
    expect(context).toEqual(sampleContext());
    expect(context.stringColumns).toEqual(stringColumnsBefore);
  });
});
