import { describe, it, expect } from 'vitest';
import {
  serializeViewState,
  parseViewState,
  getViewParamFromHash,
  buildShareLink,
  applyViewToColumns,
  facetSelectionsToRecord,
  sanitizeFacetSelections,
  VIEW_STATE_VERSION,
} from '../utils/viewState';
import type { ViewState } from '../utils/viewState';
import type { Column, DataPoint } from '../../types';
import type { FacetSelections } from '../utils/facetUtils';
import { MISSING_FACET_VALUE } from '../utils/facetUtils';
import { MIN_CELL_SIZE, MAX_CELL_SIZE } from '../utils/zoomUtils';

// Node/jsdom-compatible base64url encoder for crafting hostile payloads.
function encodePayload(json: string): string {
  return Buffer.from(json, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

const FULL_STATE: ViewState = {
  dataUrl: 'https://example.com/data.tsv',
  columns: [
    { name: 'gc_content', visible: true, scale: 'log' },
    { name: 'length', visible: false, scale: 'linear' },
    { name: 'coverage', visible: true, scale: 'linear' },
  ],
  columnFilter: 'gc',
  filterMode: 'filter',
  showHistograms: false,
  useUniformLogBins: true,
  globalLogScale: true,
  colorMode: 'category',
  categoryColorColumn: 'species',
  rainbowOrderColumn: 'length',
  facetSelections: { species: ['cat', 'dog'], site: [MISSING_FACET_VALUE] },
  showIdentityLine: true,
  showRegressionLine: true,
  showCorrelation: true,
  tintCellBorders: true,
  correlationMetric: 'spearman',
  cellSize: 220,
  showDataTable: true,
};

describe('serializeViewState / parseViewState round trip', () => {
  it('round-trips every field', () => {
    const encoded = serializeViewState(FULL_STATE);
    expect(parseViewState(encoded)).toEqual(FULL_STATE);
  });

  it('round-trips a minimal state (defaults omitted from the payload)', () => {
    const state: ViewState = {
      columns: [{ name: 'a', visible: true, scale: 'linear' }],
      filterMode: 'highlight',
      showHistograms: true,
      colorMode: 'none',
      correlationMetric: 'pearson',
    };
    const parsed = parseViewState(serializeViewState(state));
    expect(parsed).toEqual(state);
    // Omitted fields stay absent rather than defaulting.
    expect(parsed?.dataUrl).toBeUndefined();
    expect(parsed?.facetSelections).toBeUndefined();
    expect(parsed?.cellSize).toBeUndefined();
  });

  it('round-trips unicode column names and facet values', () => {
    const state: ViewState = {
      columns: [
        { name: 'longueur (µm)', visible: true, scale: 'linear' },
        { name: '数量', visible: false, scale: 'log' },
        { name: 'βeta—值 "quoted"', visible: true, scale: 'linear' },
      ],
      facetSelections: { 'espèce': ['čat', '🐟'] },
    };
    expect(parseViewState(serializeViewState(state))).toEqual(state);
  });

  it('produces a URL-safe string well under 2KB for a typical 30-column view', () => {
    const state: ViewState = {
      ...FULL_STATE,
      columns: Array.from({ length: 30 }, (_, i) => ({
        name: `measurement_column_${i}`,
        visible: i % 3 !== 0,
        scale: (i % 2 === 0 ? 'log' : 'linear') as 'log' | 'linear',
      })),
    };
    const encoded = serializeViewState(state);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, no padding
    expect(encoded.length).toBeLessThan(2048);
  });
});

describe('parseViewState tolerance', () => {
  it('returns null for garbage input', () => {
    expect(parseViewState('')).toBeNull();
    expect(parseViewState('not-base64!!!***')).toBeNull();
    expect(parseViewState(encodePayload('this is not json'))).toBeNull();
    expect(parseViewState(encodePayload('[1,2,3]'))).toBeNull();
    expect(parseViewState(encodePayload('null'))).toBeNull();
    expect(parseViewState(encodePayload('42'))).toBeNull();
  });

  it('returns null for an unknown schema version', () => {
    expect(parseViewState(encodePayload('{"v":999,"h":1}'))).toBeNull();
    expect(parseViewState(encodePayload('{"h":1}'))).toBeNull(); // missing version
  });

  it('ignores unknown fields so future additive versions stay loadable', () => {
    const payload = JSON.stringify({
      v: VIEW_STATE_VERSION,
      h: 0,
      futureField: { anything: true },
      zz: [1, 2, 3],
    });
    expect(parseViewState(encodePayload(payload))).toEqual({ showHistograms: false });
  });

  it('drops fields with the wrong shape instead of failing the whole parse', () => {
    const payload = JSON.stringify({
      v: VIEW_STATE_VERSION,
      u: 12345, // wrong type
      c: 'not-an-array',
      fs: ['not', 'an', 'object'],
      cs: 'huge', // wrong type
      fm: 'x', // unknown enum value
      cm: 'q',
      me: 'z',
      h: 1,
    });
    expect(parseViewState(encodePayload(payload))).toEqual({ showHistograms: true });
  });

  it('rejects non-positive or non-finite cell sizes', () => {
    expect(parseViewState(encodePayload(`{"v":${VIEW_STATE_VERSION},"cs":-5}`))).toEqual({});
    expect(parseViewState(encodePayload(`{"v":${VIEW_STATE_VERSION},"cs":0}`))).toEqual({});
    expect(parseViewState(encodePayload(`{"v":${VIEW_STATE_VERSION},"cs":150}`))).toEqual({ cellSize: 150 });
  });

  it('clamps out-of-range cell sizes to the zoom bounds (crafted payloads cannot force huge canvases)', () => {
    expect(parseViewState(encodePayload(`{"v":${VIEW_STATE_VERSION},"cs":1e9}`))).toEqual({ cellSize: MAX_CELL_SIZE });
    expect(parseViewState(encodePayload(`{"v":${VIEW_STATE_VERSION},"cs":1}`))).toEqual({ cellSize: MIN_CELL_SIZE });
    // In-range values pass through (rounded).
    expect(parseViewState(encodePayload(`{"v":${VIEW_STATE_VERSION},"cs":150.4}`))).toEqual({ cellSize: 150 });
  });

  it('skips malformed column entries but keeps well-formed ones', () => {
    const payload = JSON.stringify({
      v: VIEW_STATE_VERSION,
      c: [['good', 3], [42, 1], 'junk', ['also_good', 0]],
    });
    expect(parseViewState(encodePayload(payload))).toEqual({
      columns: [
        { name: 'good', visible: true, scale: 'log' },
        { name: 'also_good', visible: false, scale: 'linear' },
      ],
    });
  });
});

describe('getViewParamFromHash', () => {
  it('extracts the encoded view from a #view= fragment', () => {
    expect(getViewParamFromHash('#view=abc123')).toBe('abc123');
    expect(getViewParamFromHash('#other=x&view=abc123')).toBe('abc123');
  });

  it('returns null when absent or empty', () => {
    expect(getViewParamFromHash('')).toBeNull();
    expect(getViewParamFromHash('#')).toBeNull();
    expect(getViewParamFromHash('#view=')).toBeNull();
    expect(getViewParamFromHash('#section-heading')).toBeNull();
  });
});

describe('buildShareLink', () => {
  it('composes ?data= and #view= when the data came from a URL', () => {
    const state: ViewState = { dataUrl: 'https://ex.com/a.csv?x=1&y=2', showHistograms: true };
    const link = buildShareLink('https://host/app/', state);
    expect(link).toBe(
      `https://host/app/?data=${encodeURIComponent('https://ex.com/a.csv?x=1&y=2')}#view=${serializeViewState(state)}`
    );
    // The embedded data URL survives a round trip through URL parsing.
    const url = new URL(link);
    expect(new URLSearchParams(url.search).get('data')).toBe('https://ex.com/a.csv?x=1&y=2');
    expect(parseViewState(getViewParamFromHash(url.hash)!)?.dataUrl).toBe('https://ex.com/a.csv?x=1&y=2');
  });

  it('emits fragment-only links for locally uploaded data', () => {
    const state: ViewState = { showHistograms: false };
    const link = buildShareLink('https://host/app/', state);
    expect(link).toBe(`https://host/app/#view=${serializeViewState(state)}`);
    expect(link).not.toContain('?data=');
  });
});

describe('applyViewToColumns', () => {
  const detected: Column[] = [
    { name: 'a', scale: 'linear', visible: true },
    { name: 'b', scale: 'linear', visible: true },
    { name: 'c', scale: 'linear', visible: true },
  ];

  it('applies saved order, visibility, and scale by name', () => {
    const result = applyViewToColumns(detected, [
      { name: 'c', visible: true, scale: 'log' },
      { name: 'a', visible: false, scale: 'linear' },
      { name: 'b', visible: true, scale: 'linear' },
    ]);
    expect(result).toEqual([
      { name: 'c', visible: true, scale: 'log' },
      { name: 'a', visible: false, scale: 'linear' },
      { name: 'b', visible: true, scale: 'linear' },
    ]);
  });

  it('ignores saved columns that no longer exist', () => {
    const result = applyViewToColumns(detected, [
      { name: 'vanished', visible: true, scale: 'log' },
      { name: 'b', visible: false, scale: 'log' },
    ]);
    expect(result.map(c => c.name)).toEqual(['b', 'a', 'c']);
    expect(result[0]).toEqual({ name: 'b', visible: false, scale: 'log' });
  });

  it('appends new columns not named in the view, visible, in natural order', () => {
    const result = applyViewToColumns(detected, [
      { name: 'b', visible: false, scale: 'linear' },
    ]);
    expect(result.map(c => c.name)).toEqual(['b', 'a', 'c']);
    expect(result[1].visible).toBe(true);
    expect(result[2].visible).toBe(true);
  });

  it('falls back to the detected columns when the view list is empty or nothing matches', () => {
    expect(applyViewToColumns(detected, undefined)).toBe(detected);
    expect(applyViewToColumns(detected, [])).toBe(detected);
    expect(
      applyViewToColumns(detected, [{ name: 'zz', visible: false, scale: 'log' }])
    ).toBe(detected);
  });

  it('preserves detected-column fields beyond name/visible/scale', () => {
    // Future-proofing: if Column ever grows extra fields, applying a saved
    // view must not strip them from matched columns.
    const detectedWithExtra = detected.map(col => ({ ...col, extra: `x-${col.name}` }));
    const result = applyViewToColumns(detectedWithExtra as Column[], [
      { name: 'b', visible: false, scale: 'log' },
    ]) as Array<Column & { extra?: string }>;
    expect(result.map(c => c.extra)).toEqual(['x-b', 'x-a', 'x-c']);
  });

  it('deduplicates repeated names in a hostile payload', () => {
    const result = applyViewToColumns(detected, [
      { name: 'a', visible: false, scale: 'log' },
      { name: 'a', visible: true, scale: 'linear' },
    ]);
    expect(result.filter(c => c.name === 'a')).toHaveLength(1);
    expect(result[0]).toEqual({ name: 'a', visible: false, scale: 'log' });
  });
});

describe('facet selection conversion', () => {
  const data: DataPoint[] = [
    { __id: 0, species: 'cat', x: 1 },
    { __id: 1, species: 'dog', x: 2 },
    { __id: 2, species: '', x: 3 },
  ];

  it('converts a Map to a plain record and back through sanitize', () => {
    const facets: FacetSelections = new Map([
      ['species', new Set(['cat', 'dog'])],
    ]);
    const record = facetSelectionsToRecord(facets);
    expect(record).toEqual({ species: ['cat', 'dog'] });
    const restored = sanitizeFacetSelections(record, data, ['species']);
    expect(restored).toEqual(facets);
  });

  it('omits empty value sets when serializing', () => {
    const facets: FacetSelections = new Map([['species', new Set<string>()]]);
    expect(facetSelectionsToRecord(facets)).toEqual({});
  });

  it('keeps the missing-value sentinel when blank cells exist', () => {
    const restored = sanitizeFacetSelections(
      { species: [MISSING_FACET_VALUE] },
      data,
      ['species']
    );
    expect(restored.get('species')).toEqual(new Set([MISSING_FACET_VALUE]));
  });

  it('drops vanished values and columns', () => {
    const restored = sanitizeFacetSelections(
      {
        species: ['cat', 'unicorn'], // unicorn vanished
        habitat: ['forest'], // column vanished
        x: ['1'], // numeric column, not a string column
      },
      data,
      ['species']
    );
    expect(restored.size).toBe(1);
    expect(restored.get('species')).toEqual(new Set(['cat']));
  });

  it('drops a column whose selected values all vanished (no empty facet)', () => {
    const restored = sanitizeFacetSelections({ species: ['unicorn'] }, data, ['species']);
    expect(restored.size).toBe(0);
  });

  it('handles undefined input', () => {
    expect(sanitizeFacetSelections(undefined, data, ['species']).size).toBe(0);
  });

  it('ignores non-array values in wire-form input that bypassed parseViewState', () => {
    const hostile = { species: 'cat' } as unknown as Record<string, string[]>;
    expect(sanitizeFacetSelections(hostile, data, ['species']).size).toBe(0);
  });
});
