import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { ScatterPlotMatrix } from '../../components/ScatterPlotMatrix';
import type { Column, DataPoint } from '../../types';

// Smoke test for the reference-line overlay pass (issue #50): with both
// toggles enabled the paint loop must run the overlay code path (identity
// sampling, regression fit + draw, r² label) and still complete cleanly,
// across linear and log axes.
const makeProps = (overrides: Partial<React.ComponentProps<typeof ScatterPlotMatrix>> = {}) => {
    const data: DataPoint[] = Array.from({ length: 50 }, (_, i) => ({
        __id: i,
        a: i + 1,
        b: 2 * (i + 1) + 3,
        c: Math.pow(10, (i % 5) + 1),
    }));
    const columns: Column[] = [
        { name: 'a', scale: 'linear', visible: true },
        { name: 'b', scale: 'linear', visible: true },
        { name: 'c', scale: 'log', visible: true },
    ];
    return {
        data,
        columns,
        onColumnReorder: () => { },
        brushSelection: null,
        onBrush: () => { },
        filterMode: 'highlight' as const,
        showHistograms: false,
        useUniformLogBins: false,
        labelColumn: null,
        onPointHover: () => { },
        onPointLeave: () => { },
        cellSize: 120,
        ...overrides,
    };
};

describe('ScatterPlotMatrix reference-line rendering', () => {
    it('completes a render with both reference-line toggles enabled', async () => {
        const onRenderComplete = vi.fn();
        render(
            <DndProvider backend={HTML5Backend}>
                <ScatterPlotMatrix
                    {...makeProps({ onRenderComplete })}
                    showIdentityLine
                    showRegressionLine
                />
            </DndProvider>
        );

        await waitFor(() => expect(onRenderComplete).toHaveBeenCalled());
    });

    it('repaints cells (new render keys) when a reference-line toggle flips', async () => {
        const onRenderComplete = vi.fn();
        // Stable props object: the SAME data/columns arrays across rerenders,
        // so the data hash cannot change — only the toggle differs. If the
        // toggles were missing from the render key, no cell would repaint.
        const props = makeProps({ onRenderComplete });
        const { rerender } = render(
            <DndProvider backend={HTML5Backend}>
                <ScatterPlotMatrix {...props} />
            </DndProvider>
        );
        await waitFor(() => expect(onRenderComplete).toHaveBeenCalled());

        // Cell canvases are only touched (getContext) when a cell repaints.
        const getContextMock = HTMLCanvasElement.prototype.getContext as unknown as ReturnType<typeof vi.fn>;
        const callsBefore = getContextMock.mock.calls.length;

        rerender(
            <DndProvider backend={HTML5Backend}>
                <ScatterPlotMatrix {...props} showIdentityLine />
            </DndProvider>
        );
        await waitFor(() => expect(getContextMock.mock.calls.length).toBeGreaterThan(callsBefore));
    });
});
