import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import * as d3 from 'd3';
import React from 'react';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { ScatterPlotMatrix } from '../../components/ScatterPlotMatrix';
import type { Column, DataPoint } from '../../types';

describe('ScatterPlotMatrix brush integration', () => {
    it('calls onBrush with selectedIds after user drag', async () => {
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

        const onBrush = vi.fn();

        const { container } = render(
            <DndProvider backend={HTML5Backend}>
                <ScatterPlotMatrix
                    data={data}
                    columns={columns}
                    onColumnReorder={() => { }}
                    brushSelection={null}
                    onBrush={onBrush}
                    filterMode="highlight"
                    showHistograms={false}
                    labelColumn={null}
                    onPointHover={() => { }}
                    onPointLeave={() => { }}
                />
            </DndProvider>
        );

        // The first off-diagonal cell is (0,1). d3 attaches a rect.overlay for events
        const overlay = container.querySelector('g[data-index-i="0"][data-index-j="1"] rect.overlay');
        expect(overlay).toBeTruthy();
        if (!overlay) return;

        const bbox = (overlay as SVGGraphicsElement).getBoundingClientRect();
        // Simulate drag gesture roughly in the middle of the cell
        await act(async () => {
            fireEvent.pointerDown(overlay, { clientX: bbox.x + 10, clientY: bbox.y + 10, pointerId: 1 });
            fireEvent.pointerMove(overlay, { clientX: bbox.x + 60, clientY: bbox.y + 60, pointerId: 1 });
            fireEvent.pointerUp(overlay, { clientX: bbox.x + 60, clientY: bbox.y + 60, pointerId: 1 });
        });

        expect(onBrush).toHaveBeenCalled();
        const arg = onBrush.mock.calls[0][0];
        expect(arg.selectedIds.size).toBeGreaterThan(0);
    });
});
