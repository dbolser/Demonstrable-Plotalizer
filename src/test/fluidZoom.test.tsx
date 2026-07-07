import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import React from 'react';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { ScatterPlotMatrix } from '../../components/ScatterPlotMatrix';
import type { Column, DataPoint } from '../../types';
import { accumulateWheelZoom, commitZoom } from '../utils/zoomUtils';

const makeProps = (overrides: Partial<React.ComponentProps<typeof ScatterPlotMatrix>> = {}) => {
    const data: DataPoint[] = Array.from({ length: 20 }, (_, i) => ({
        __id: i,
        a: i,
        b: 20 - i,
    }));
    const columns: Column[] = [
        { name: 'a', scale: 'linear', visible: true },
        { name: 'b', scale: 'linear', visible: true },
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
        cellSize: 150,
        ...overrides,
    };
};

const renderMatrix = (overrides: Partial<React.ComponentProps<typeof ScatterPlotMatrix>> = {}) => {
    const props = makeProps(overrides);
    const utils = render(
        <DndProvider backend={HTML5Backend}>
            <ScatterPlotMatrix {...props} />
        </DndProvider>
    );
    const root = utils.container.firstElementChild as HTMLElement;
    return { ...utils, root };
};

const dispatchWheel = (el: HTMLElement, init: WheelEventInit): boolean => {
    let notPrevented = true;
    act(() => {
        notPrevented = el.dispatchEvent(
            new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init })
        );
    });
    return notPrevented;
};

describe('fluid zoom gesture (issue #57)', () => {
    it('plain wheel scrolls normally: no transform, no preventDefault, no commit', async () => {
        const onCellSizeChange = vi.fn();
        const { root } = renderMatrix({ onCellSizeChange });

        const notPrevented = dispatchWheel(root, { deltaY: -100 });

        expect(notPrevented).toBe(true); // browser scrolling untouched
        expect(root.style.transform).toBe('');
        await new Promise(resolve => setTimeout(resolve, 300));
        expect(onCellSizeChange).not.toHaveBeenCalled();
    });

    it('Ctrl+wheel applies a CSS scale preview and prevents browser page-zoom', () => {
        const { root } = renderMatrix({ onCellSizeChange: vi.fn() });

        const notPrevented = dispatchWheel(root, { deltaY: -100, ctrlKey: true });

        expect(notPrevented).toBe(false); // preventDefault() was called
        const expectedScale = accumulateWheelZoom(1, -100, 150);
        expect(root.style.transform).toBe(`scale(${expectedScale})`);
    });

    it('commits round(cellSize * scale) after the debounce and resets the transform', async () => {
        const onCellSizeChange = vi.fn();
        const { root } = renderMatrix({ onCellSizeChange });

        dispatchWheel(root, { deltaY: -100, ctrlKey: true });
        dispatchWheel(root, { deltaY: -100, ctrlKey: true });
        expect(root.style.transform).not.toBe('');

        const expectedScale = accumulateWheelZoom(
            accumulateWheelZoom(1, -100, 150), -100, 150
        );
        await waitFor(() =>
            expect(onCellSizeChange).toHaveBeenCalledWith(commitZoom(150, expectedScale))
        );
        expect(onCellSizeChange).toHaveBeenCalledTimes(1);
        expect(root.style.transform).toBe(''); // preview reset on commit
    });

    it('the gesture never retriggers the paint pipeline (CSS transform only)', async () => {
        const onCellSizeChange = vi.fn();
        const onRenderComplete = vi.fn();
        const { root } = renderMatrix({ onCellSizeChange, onRenderComplete });

        // Let the initial mount render finish.
        await waitFor(() => expect(onRenderComplete).toHaveBeenCalledTimes(1));

        // A multi-tick gesture: transient state updates must not re-run the
        // paint effect (which would call onRenderComplete again) or resize
        // the canvases.
        const canvas = root.querySelector('canvas') as HTMLCanvasElement;
        const widthBefore = canvas.width;
        dispatchWheel(root, { deltaY: -100, ctrlKey: true });
        dispatchWheel(root, { deltaY: -50, ctrlKey: true });
        dispatchWheel(root, { deltaY: 25, ctrlKey: true });

        await waitFor(() => expect(onCellSizeChange).toHaveBeenCalledTimes(1));
        expect(onRenderComplete).toHaveBeenCalledTimes(1);
        expect(canvas.width).toBe(widthBefore);
    });
});
