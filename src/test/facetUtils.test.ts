import { describe, it, expect } from 'vitest';
import type { DataPoint } from '../../types';
import {
  MISSING_FACET_VALUE,
  MAX_FACET_VALUES,
  applyFacets,
  buildFacetSummaries,
  countActiveFacets,
  getFacetValue,
  rowPassesFacets,
  setColumnFacet,
  toggleFacetValue,
} from '../utils/facetUtils';
import type { FacetSelections } from '../utils/facetUtils';

const makeRow = (id: number, fields: Record<string, string | number | null | undefined>): DataPoint => {
  const row: DataPoint = { __id: id };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== null && value !== undefined) row[key] = value;
    else if (value === null) row[key] = null as unknown as string; // PapaParse stores blank cells as null
  }
  return row;
};

// species x habitat grid with some missing cells
const data: DataPoint[] = [
  makeRow(0, { species: 'setosa', habitat: 'wet' }),
  makeRow(1, { species: 'setosa', habitat: 'dry' }),
  makeRow(2, { species: 'versicolor', habitat: 'wet' }),
  makeRow(3, { species: 'versicolor', habitat: null }),
  makeRow(4, { species: 'virginica', habitat: 'dry' }),
  makeRow(5, { species: '', habitat: 'wet' }),
  makeRow(6, { species: '   ', habitat: 'dry' }),
];

const facets = (entries: [string, string[]][]): FacetSelections =>
  new Map(entries.map(([col, values]) => [col, new Set(values)]));

describe('getFacetValue', () => {
  it('returns the string form of a value', () => {
    expect(getFacetValue(data[0], 'species')).toBe('setosa');
  });

  it('stringifies numeric cells', () => {
    expect(getFacetValue(makeRow(0, { grade: 3 }), 'grade')).toBe('3');
  });

  it('maps undefined, null, and blank strings to the missing sentinel', () => {
    expect(getFacetValue(makeRow(0, {}), 'species')).toBe(MISSING_FACET_VALUE);
    expect(getFacetValue(makeRow(0, { species: null }), 'species')).toBe(MISSING_FACET_VALUE);
    expect(getFacetValue(makeRow(0, { species: '' }), 'species')).toBe(MISSING_FACET_VALUE);
    expect(getFacetValue(makeRow(0, { species: '  ' }), 'species')).toBe(MISSING_FACET_VALUE);
  });
});

describe('rowPassesFacets / applyFacets semantics', () => {
  it('no facets = identity: every row passes and the SAME array reference is returned', () => {
    expect(applyFacets(data, new Map())).toBe(data);
    // Defensive: an empty set for a column also means "no facet"
    expect(applyFacets(data, facets([['species', []]]))).toBe(data);
  });

  it('an active facet returns a NEW array reference (canvas cache invalidation seam)', () => {
    const result = applyFacets(data, facets([['species', ['setosa']]]));
    expect(result).not.toBe(data);
    // ScatterPlotMatrix bumps its data version on reference change; a new
    // reference per facet change is what invalidates cached canvases.
  });

  it('OR within a column: any selected value passes', () => {
    const result = applyFacets(data, facets([['species', ['setosa', 'virginica']]]));
    expect(result.map(r => r.__id)).toEqual([0, 1, 4]);
  });

  it('AND across columns', () => {
    const result = applyFacets(
      data,
      facets([
        ['species', ['setosa', 'versicolor']],
        ['habitat', ['wet']],
      ])
    );
    expect(result.map(r => r.__id)).toEqual([0, 2]);
  });

  it('missing/blank cells only pass when the missing entry is selected', () => {
    const withoutMissing = applyFacets(data, facets([['species', ['setosa']]]));
    expect(withoutMissing.every(r => getFacetValue(r, 'species') !== MISSING_FACET_VALUE)).toBe(true);

    const withMissing = applyFacets(data, facets([['species', [MISSING_FACET_VALUE]]]));
    expect(withMissing.map(r => r.__id)).toEqual([5, 6]);

    const habitatMissing = applyFacets(data, facets([['habitat', [MISSING_FACET_VALUE]]]));
    expect(habitatMissing.map(r => r.__id)).toEqual([3]);
  });

  it('a facet matching nothing yields an empty array', () => {
    expect(applyFacets(data, facets([['species', ['nope']]]))).toEqual([]);
  });

  it('rowPassesFacets ignores columns absent from the row only via the missing entry', () => {
    const row = makeRow(9, {});
    expect(rowPassesFacets(row, facets([['species', ['setosa']]]))).toBe(false);
    expect(rowPassesFacets(row, facets([['species', [MISSING_FACET_VALUE]]]))).toBe(true);
  });
});

describe('toggleFacetValue / setColumnFacet / countActiveFacets', () => {
  it('toggling adds then removes a value immutably', () => {
    const start: FacetSelections = new Map();
    const added = toggleFacetValue(start, 'species', 'setosa');
    expect(start.size).toBe(0); // input untouched
    expect(added.get('species')).toEqual(new Set(['setosa']));

    const removed = toggleFacetValue(added, 'species', 'setosa');
    expect(added.get('species')).toEqual(new Set(['setosa'])); // input untouched
    expect(removed.has('species')).toBe(false); // empty set drops the column
  });

  it('setColumnFacet replaces a column facet and clears on null/empty', () => {
    const one = setColumnFacet(new Map(), 'species', new Set(['a', 'b']));
    expect(one.get('species')).toEqual(new Set(['a', 'b']));

    const clearedNull = setColumnFacet(one, 'species', null);
    expect(clearedNull.has('species')).toBe(false);

    const clearedEmpty = setColumnFacet(one, 'species', new Set());
    expect(clearedEmpty.has('species')).toBe(false);
  });

  it('countActiveFacets counts columns with non-empty sets', () => {
    expect(countActiveFacets(new Map())).toBe(0);
    expect(countActiveFacets(facets([['a', ['x']], ['b', ['y', 'z']]]))).toBe(2);
    expect(countActiveFacets(facets([['a', []]]))).toBe(0);
  });
});

describe('buildFacetSummaries', () => {
  it('extracts distinct values with counts, alphabetical with missing last', () => {
    const [species] = buildFacetSummaries(data, ['species'], new Map());
    expect(species.facetable).toBe(true);
    expect(species.distinctCount).toBe(4); // setosa, versicolor, virginica, (missing)
    expect(species.values.map(v => v.value)).toEqual([
      'setosa', 'versicolor', 'virginica', MISSING_FACET_VALUE,
    ]);
    expect(species.values.map(v => v.count)).toEqual([2, 2, 1, 2]);
    expect(species.values[3].isMissing).toBe(true);
  });

  it("counts within OTHER columns' facets, excluding the column's own facet", () => {
    const active = facets([
      ['habitat', ['wet']],
      ['species', ['setosa']], // must NOT constrain its own counts
    ]);
    const [species, habitat] = buildFacetSummaries(data, ['species', 'habitat'], active);

    // species counts restricted to habitat=wet rows (ids 0, 2, 5)
    const speciesCounts = Object.fromEntries(species.values.map(v => [v.value, v.count]));
    expect(speciesCounts).toEqual({
      setosa: 1,
      versicolor: 1,
      virginica: 0, // still listed (exists globally) so its checkbox never vanishes
      [MISSING_FACET_VALUE]: 1,
    });

    // habitat counts restricted to species=setosa rows (ids 0, 1)
    const habitatCounts = Object.fromEntries(habitat.values.map(v => [v.value, v.count]));
    expect(habitatCounts).toEqual({
      dry: 1,
      wet: 1,
      [MISSING_FACET_VALUE]: 0,
    });
  });

  it('flags columns above the distinct-value cap as not facetable', () => {
    const wide: DataPoint[] = Array.from({ length: MAX_FACET_VALUES + 5 }, (_, i) =>
      makeRow(i, { id_col: `v${i}`, ok_col: i % 2 === 0 ? 'even' : 'odd' })
    );
    const [idCol, okCol] = buildFacetSummaries(wide, ['id_col', 'ok_col'], new Map());

    expect(idCol.facetable).toBe(false);
    expect(idCol.distinctCount).toBe(MAX_FACET_VALUES + 5);
    expect(idCol.values).toEqual([]);

    expect(okCol.facetable).toBe(true);
    expect(okCol.values.map(v => v.value)).toEqual(['even', 'odd']);
  });

  it('a column with exactly MAX_FACET_VALUES distinct values is still facetable', () => {
    const rows: DataPoint[] = Array.from({ length: MAX_FACET_VALUES }, (_, i) =>
      makeRow(i, { c: `v${i}` })
    );
    const [summary] = buildFacetSummaries(rows, ['c'], new Map());
    expect(summary.facetable).toBe(true);
    expect(summary.values).toHaveLength(MAX_FACET_VALUES);
  });
});
