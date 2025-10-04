import { describe, it, expect } from 'vitest';
import * as d3 from 'd3';
import { createSpatialGrid, getPointsInBrush } from '../utils/selectionUtils';

describe('spatial grid selection', () => {
  const size = 150;
  const padding = 20;
  const xCol = 'x';
  const yCol = 'y';

  const data = Array.from({ length: 100 }, (_, i) => ({
    __id: i,
    [xCol]: i,
    [yCol]: i,
  }));

  const xScale = d3.scaleLinear().domain([0, 99]).range([padding / 2, size - padding / 2]);
  const yScale = d3.scaleLinear().domain([0, 99]).range([size - padding / 2, padding / 2]);

  it('selects correct ids within brush bounds', () => {
    const grid = createSpatialGrid(data, xScale, yScale, xCol, yCol, size);
    const ids = getPointsInBrush(
      grid,
      xScale,
      yScale,
      xScale(10),
      yScale(20),
      xScale(20),
      yScale(10),
      xCol,
      yCol,
      size
    );
    expect(ids.size).toBeGreaterThan(0);
    expect(ids.has(15)).toBe(true);
  });
});
