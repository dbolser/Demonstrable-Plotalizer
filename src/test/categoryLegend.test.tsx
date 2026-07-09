import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { ControlPanel } from '../../components/ControlPanel';
import { computeColorState } from '../utils/colorUtils';
import { buildFacetSummaries } from '../utils/facetUtils';
import type { FacetSelections } from '../utils/facetUtils';
import type { DataPoint } from '../../types';

// 3 setosa, 2 versicolor, 1 virginica — legend must list them in that order.
const data: DataPoint[] = [
  { __id: 0, species: 'virginica', x: 1 },
  { __id: 1, species: 'setosa', x: 2 },
  { __id: 2, species: 'versicolor', x: 3 },
  { __id: 3, species: 'setosa', x: 4 },
  { __id: 4, species: 'versicolor', x: 5 },
  { __id: 5, species: 'setosa', x: 6 },
];

function renderPanel(overrides: Partial<React.ComponentProps<typeof ControlPanel>> = {}) {
  const facetSelections: FacetSelections = new Map();
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
    showCorrelation: false,
    setShowCorrelation: vi.fn(),
    tintCellBorders: false,
    setTintCellBorders: vi.fn(),
    correlationMetric: 'pearson',
    setCorrelationMetric: vi.fn(),
    onSortByCorrelation: vi.fn(),
    canRestoreColumnOrder: false,
    onRestoreColumnOrder: vi.fn(),
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
    colorMode: 'category',
    setColorMode: vi.fn(),
    categoryColorColumn: 'species',
    setCategoryColorColumn: vi.fn(),
    onToggleCategory: vi.fn(),
    rainbowOrderColumn: null,
    onResetRainbowOrder: vi.fn(),
    colorState: computeColorState(data, 'category', 'species', null),
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

describe('category legend', () => {
  it('lists categories sorted by count, descending, with their counts', () => {
    const { getByTestId } = renderPanel();
    const legend = getByTestId('category-legend');
    const buttons = within(legend).getAllByRole('button');

    expect(buttons.map(b => b.textContent)).toEqual([
      'setosa3',
      'versicolor2',
      'virginica1',
    ]);
  });

  it('clicking an entry toggles that category', () => {
    const { getByTestId, props } = renderPanel();
    const legend = getByTestId('category-legend');
    fireEvent.click(within(legend).getByRole('button', { name: /virginica/ }));
    expect(props.onToggleCategory).toHaveBeenCalledWith('virginica');
  });

  it('marks hidden categories as toggled off', () => {
    const { getByTestId } = renderPanel({
      colorState: computeColorState(data, 'category', 'species', null, new Set(['versicolor'])),
    });
    const legend = getByTestId('category-legend');
    const hidden = within(legend).getByRole('button', { name: /versicolor/ });
    const shown = within(legend).getByRole('button', { name: /setosa/ });
    expect(hidden.getAttribute('aria-pressed')).toBe('false');
    expect(shown.getAttribute('aria-pressed')).toBe('true');
  });
});
