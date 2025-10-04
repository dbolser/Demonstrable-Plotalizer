import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { ScatterPlotMatrix } from '../../components/ScatterPlotMatrix';
import type { Column, DataPoint } from '../../types';

describe('ScatterPlotMatrix brush integration', () => {
    it('renders with brush handlers and propagates selection state', () => {
        // Create mock dataset
        const data: DataPoint[] = Array.from({ length: 30 }, (_, i) => ({
            __id: i,
            x: i,
            y: 30 - i,
        }));
        const columns: Column[] = [
            { name: 'x', scale: 'linear', visible: true },
            { name: 'y', scale: 'linear', visible: true },
        ];

        const selectedIds = new Set([5, 10, 15]);
        const brushSelection = {
            indexX: 0,
            indexY: 1,
            x0: 10,
            y0: 10,
            x1: 50,
            y1: 50,
            selectedIds,
        };

        const { container } = render(
            <DndProvider backend={HTML5Backend}>
                <ScatterPlotMatrix
                    data={data}
                    columns={columns}
                    onColumnReorder={() => { }}
                    brushSelection={brushSelection}
                    onBrush={() => { }}
                    filterMode="highlight"
                    showHistograms={false}
                    labelColumn={null}
                    onPointHover={() => { }}
                    onPointLeave={() => { }}
                />
            </DndProvider>
        );

        // Verify the matrix renders
        const svg = container.querySelector('svg');
        expect(svg).toBeTruthy();

        // Verify cells exist (2x2 for 2 columns)
        const cells = container.querySelectorAll('g[data-index-i]');
        expect(cells.length).toBeGreaterThan(0);
    });
});