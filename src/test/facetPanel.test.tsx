import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { ControlPanel } from '../../components/ControlPanel';
import { buildFacetSummaries, MISSING_FACET_VALUE } from '../utils/facetUtils';
import type { FacetSelections } from '../utils/facetUtils';
import type { DataPoint } from '../../types';

const data: DataPoint[] = [
  { __id: 0, species: 'setosa', x: 1 },
  { __id: 1, species: 'setosa', x: 2 },
  { __id: 2, species: 'versicolor', x: 3 },
  { __id: 3, species: '', x: 4 },
];

function renderPanel(overrides: Partial<React.ComponentProps<typeof ControlPanel>> = {}) {
  const facetSelections: FacetSelections =
    overrides.facetSelections ?? new Map();
  const props: React.ComponentProps<typeof ControlPanel> = {
    columns: [{ name: 'x', scale: 'linear', visible: true }],
    visibleDisplayCount: 1,
    onColumnUpdate: vi.fn(),
    onDataLoaded: vi.fn(),
    onLoadFromUrl: vi.fn(),
    isUrlLoading: false,
    filterMode: 'highlight',
    setFilterMode: vi.fn(),
    showHistograms: false,
    setShowHistograms: vi.fn(),
    showDataTable: false,
    setShowDataTable: vi.fn(),
    useUniformLogBins: false,
    setUseUniformLogBins: vi.fn(),
    globalLogScale: false,
    onToggleGlobalLogScale: vi.fn(),
    showIdentityLine: false,
    setShowIdentityLine: vi.fn(),
    showRegressionLine: false,
    setShowRegressionLine: vi.fn(),
    stringColumns: ['species'],
    columnFilter: '',
    onColumnFilterChange: vi.fn(),
    cellSize: 150,
    onCellSizeChange: vi.fn(),
    showColumnGroups: false,
    columnGroups: new Map(),
    onToggleColumnGroups: vi.fn(),
    onColumnGroupUpdate: vi.fn(),
    recentFiles: [],
    onLoadFromHistory: vi.fn(),
    onDeleteFromHistory: vi.fn(),
    onAddPCA: vi.fn(),
    pcaVariance: null,
    colorMode: 'none',
    setColorMode: vi.fn(),
    categoryColorColumn: null,
    setCategoryColorColumn: vi.fn(),
    rainbowOrderColumn: null,
    onResetRainbowOrder: vi.fn(),
    colorState: null,
    facetSummaries: buildFacetSummaries(data, ['species'], facetSelections),
    facetSelections,
    activeFacetCount: 0,
    onToggleFacetValue: vi.fn(),
    onSetColumnFacet: vi.fn(),
    onClearAllFacets: vi.fn(),
    ...overrides,
  };
  return { ...render(<ControlPanel {...props} />), props };
}

// The Facets panel section starts collapsed unless a facet is active (#58),
// so tests exercising an inactive panel expand the section header first.
function expandFacetsSection(utils: ReturnType<typeof render>) {
  fireEvent.click(utils.getByRole('button', { name: /^Facets/ }));
}

describe('ControlPanel Facets section', () => {
  it('renders the section with a collapsed entry per category column', () => {
    const utils = renderPanel();
    const { getByTestId, getByText, queryByText } = utils;
    expect(getByTestId('facets-section')).toBeTruthy();
    expandFacetsSection(utils);
    expect(getByText('species')).toBeTruthy();
    // Collapsed by default: value checkboxes not rendered yet
    expect(queryByText(/setosa/)).toBeNull();
  });

  it('expanding a column shows values with counts and missing entry, and toggling fires the handler', () => {
    const utils = renderPanel();
    const { getByText, getByTestId, props } = utils;
    expandFacetsSection(utils);
    fireEvent.click(getByText('species'));

    const section = within(getByTestId('facets-section'));
    expect(section.getByText('setosa')).toBeTruthy();
    expect(section.getByText('(2)')).toBeTruthy(); // setosa count
    expect(section.getByText(MISSING_FACET_VALUE)).toBeTruthy();

    const setosaCheckbox = section.getByText('setosa').closest('label')!
      .querySelector('input')!;
    expect(setosaCheckbox.checked).toBe(false);
    fireEvent.click(setosaCheckbox);
    expect(props.onToggleFacetValue).toHaveBeenCalledWith('species', 'setosa');
  });

  it('All / None shortcuts call onSetColumnFacet with every value / null', () => {
    const utils = renderPanel();
    const { getByText, getByTestId, props } = utils;
    expandFacetsSection(utils);
    fireEvent.click(getByText('species'));
    const section = within(getByTestId('facets-section'));

    fireEvent.click(section.getByText('All'));
    expect(props.onSetColumnFacet).toHaveBeenCalledWith(
      'species',
      new Set(['setosa', 'versicolor', MISSING_FACET_VALUE])
    );

    fireEvent.click(section.getByText('None'));
    expect(props.onSetColumnFacet).toHaveBeenCalledWith('species', null);
  });

  it('active facets show checked boxes, the count badge, and a working Clear all', () => {
    const facetSelections: FacetSelections = new Map([['species', new Set(['setosa'])]]);
    const { getByText, getByTestId, props } = renderPanel({
      facetSelections,
      activeFacetCount: 1,
    });

    expect(getByTestId('active-facet-count').textContent).toBe('1');

    fireEvent.click(getByText('species'));
    const section = within(getByTestId('facets-section'));
    const setosaCheckbox = section.getByText('setosa').closest('label')!
      .querySelector('input')!;
    expect(setosaCheckbox.checked).toBe(true);

    fireEvent.click(getByText('Clear all'));
    expect(props.onClearAllFacets).toHaveBeenCalled();
  });

  it('columns over the distinct-value cap show a note instead of checkboxes', () => {
    const wide: DataPoint[] = Array.from({ length: 40 }, (_, i) => ({
      __id: i,
      id_col: `v${i}`,
    }));
    const utils = renderPanel({
      stringColumns: ['id_col'],
      facetSummaries: buildFacetSummaries(wide, ['id_col'], new Map()),
    });
    const { getByText, getByTestId } = utils;

    expandFacetsSection(utils);
    fireEvent.click(getByText('id_col'));
    const section = within(getByTestId('facets-section'));
    expect(
      section.getByText(/40 distinct values — too many to facet/)
    ).toBeTruthy();
    expect(section.queryByRole('checkbox')).toBeNull();
  });

  it('renders no Facets section when there are no category columns', () => {
    const { queryByTestId } = renderPanel({
      stringColumns: [],
      facetSummaries: [],
    });
    expect(queryByTestId('facets-section')).toBeNull();
  });
});
