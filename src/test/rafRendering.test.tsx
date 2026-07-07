import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { ScatterPlotMatrix } from '../../components/ScatterPlotMatrix';
import type { Column, DataPoint } from '../../types';

const makeProps = (overrides: Partial<React.ComponentProps<typeof ScatterPlotMatrix>> = {}) => {
    const data: DataPoint[] = Array.from({ length: 50 }, (_, i) => ({
        __id: i,
        a: i,
        b: 50 - i,
        c: (i * 7) % 50,
    }));
    const columns: Column[] = [
        { name: 'a', scale: 'linear', visible: true },
        { name: 'b', scale: 'linear', visible: true },
        { name: 'c', scale: 'linear', visible: true },
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
        ...overrides,
    };
};

describe('RAF-chunked canvas rendering', () => {
    it('calls onRenderComplete once all cells have been painted', async () => {
        const onRenderComplete = vi.fn();
        render(
            <DndProvider backend={HTML5Backend}>
                <ScatterPlotMatrix {...makeProps({ onRenderComplete })} />
            </DndProvider>
        );

        await waitFor(() => expect(onRenderComplete).toHaveBeenCalled());
    });

    it('cancels cleanly on unmount without stale callbacks', async () => {
        const onRenderComplete = vi.fn();
        const cafSpy = vi.spyOn(window, 'cancelAnimationFrame');
        try {
            const { unmount } = render(
                <DndProvider backend={HTML5Backend}>
                    <ScatterPlotMatrix {...makeProps({ onRenderComplete })} />
                </DndProvider>
            );

            // Unmount immediately, before any animation frame can fire.
            unmount();

            // The effect cleanup must cancel its pending frame deterministically.
            expect(cafSpy).toHaveBeenCalled();

            // Secondary check: give any (incorrectly) leaked frames a chance
            // to run and assert the stale completion never fires.
            await new Promise(resolve => setTimeout(resolve, 50));
            expect(onRenderComplete).not.toHaveBeenCalled();
        } finally {
            cafSpy.mockRestore();
        }
    });

    it('reports progress for multi-frame renders', async () => {
        // 6 visible columns -> 30 brushable cells -> multiple frames at 4 cells/frame
        const columns: Column[] = ['a', 'b', 'c', 'd', 'e', 'f'].map(name => ({
            name,
            scale: 'linear' as const,
            visible: true,
        }));
        const data: DataPoint[] = Array.from({ length: 20 }, (_, i) => ({
            __id: i,
            a: i, b: i * 2, c: i * 3, d: i * 4, e: i * 5, f: i * 6,
        }));

        const onRenderComplete = vi.fn();
        const onRenderProgress = vi.fn();
        render(
            <DndProvider backend={HTML5Backend}>
                <ScatterPlotMatrix {...makeProps({ data, columns, onRenderComplete, onRenderProgress })} />
            </DndProvider>
        );

        await waitFor(() => expect(onRenderComplete).toHaveBeenCalled());

        expect(onRenderProgress).toHaveBeenCalled();
        const lastCall = onRenderProgress.mock.calls[onRenderProgress.mock.calls.length - 1];
        // Final progress report covers all 30 brushable cells (6x6 minus diagonal)
        expect(lastCall).toEqual([30, 30]);
    });
});
