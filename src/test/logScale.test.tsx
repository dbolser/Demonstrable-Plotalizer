import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { expect, test, vi } from 'vitest';
import { ScatterPlotMatrix } from '../../components/ScatterPlotMatrix';
import type { DataPoint, Column } from '../../types';

// Mock the onBrush and other callbacks
const mockOnBrush = vi.fn();
const mockOnColumnReorder = vi.fn();
const mockOnPointHover = vi.fn();
const mockOnPointLeave = vi.fn();

const mockData: DataPoint[] = [
    { __id: 0, a: 1, b: 10, c: 100 },
    { __id: 1, a: 2, b: 20, c: 200 },
    { __id: 2, a: 3, b: 30, c: 300 },
];

const mockColumns: Column[] = [
    { name: 'a', scale: 'linear', visible: true },
    { name: 'b', scale: 'linear', visible: true },
    { name: 'c', scale: 'linear', visible: true },
];

test('toggling log scale updates the axes', () => {
    const { rerender } = render(
        <DndProvider backend={HTML5Backend}>
            <ScatterPlotMatrix
                data={mockData}
                columns={mockColumns}
                onColumnReorder={mockOnColumnReorder}
                brushSelection={null}
                onBrush={mockOnBrush}
                filterMode="highlight"
                showHistograms={true}
                useUniformLogBins={false}
                labelColumn="a"
                onPointHover={mockOnPointHover}
                onPointLeave={mockOnPointLeave}
            />
        </DndProvider>
    );

    // Get the initial tick labels for column 'b'
    const axisBCell = screen.getByTestId('diagonal-cell-b');
    const initialTicks = Array.from(axisBCell.querySelectorAll('.tick')).map(
        tick => tick.textContent
    );

    // Re-render with log scale for column 'b'
    const columnsWithLog: Column[] = mockColumns.map(c =>
        c.name === 'b' ? { ...c, scale: 'log' } : c
    );

    rerender(
        <DndProvider backend={HTML5Backend}>
            <ScatterPlotMatrix
                data={mockData}
                columns={columnsWithLog}
                onColumnReorder={mockOnColumnReorder}
                brushSelection={null}
                onBrush={mockOnBrush}
                filterMode="highlight"
                showHistograms={true}
                useUniformLogBins={false}
                labelColumn="a"
                onPointHover={mockOnPointHover}
                onPointLeave={mockOnPointLeave}
            />
        </DndProvider>
    );

    // Get the new tick labels
    const axisBCellAfter = screen.getByTestId('diagonal-cell-b');
    const newTicks = Array.from(
        axisBCellAfter.querySelectorAll('.tick')
    ).map(tick => tick.textContent);

    // The ticks should have changed
    expect(initialTicks).not.toEqual(newTicks);
});
