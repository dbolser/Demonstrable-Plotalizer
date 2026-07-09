import { describe, it, expect, vi } from 'vitest';
import {
  collectCanvasPlacements,
  collectLabelPlacements,
  drawLabelPlacements,
  svgToDataUrl,
  wrapTextBreakAll,
  type LabelPlacement,
} from '../utils/exportPng';

describe('collectCanvasPlacements', () => {
  it('reads left/top from canvas inline styles', () => {
    const container = document.createElement('div');
    const c1 = document.createElement('canvas');
    c1.style.left = '150px';
    c1.style.top = '300px';
    const c2 = document.createElement('canvas'); // no position set
    container.append(c1, c2);

    const placements = collectCanvasPlacements(container);
    expect(placements).toHaveLength(2);
    expect(placements[0]).toMatchObject({ left: 150, top: 300 });
    expect(placements[1]).toMatchObject({ left: 0, top: 0 });
  });

  it('ignores non-canvas children', () => {
    const container = document.createElement('div');
    container.appendChild(document.createElement('div'));
    expect(collectCanvasPlacements(container)).toHaveLength(0);
  });
});

describe('svgToDataUrl', () => {
  it('produces a data URL with the xmlns needed for standalone rasterization', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    svg.setAttribute('width', '300');
    const url = svgToDataUrl(svg);
    expect(url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    const decoded = decodeURIComponent(url.split(',')[1]);
    expect(decoded).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(decoded).toContain('width="300"');
  });

  it('does not mutate the original element', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    svgToDataUrl(svg);
    expect(svg.getAttribute('xmlns:xlink')).toBeNull();
    expect(svg.style.fontFamily).toBe('');
  });
});

describe('collectLabelPlacements', () => {
  it('measures marked labels relative to the given origin', () => {
    const container = document.createElement('div');
    const label = document.createElement('span');
    label.dataset.columnLabel = 'PC1';
    label.textContent = 'PC1gradient order'; // badge text must not leak into the export
    label.getBoundingClientRect = () =>
      ({ left: 130, top: 240, width: 60, height: 28 } as DOMRect);
    container.appendChild(label);
    container.appendChild(document.createElement('span')); // unmarked → ignored

    const placements = collectLabelPlacements(container, { left: 100, top: 200 });
    expect(placements).toHaveLength(1);
    expect(placements[0]).toMatchObject({
      text: 'PC1',
      left: 30,
      top: 40,
      width: 60,
      height: 28,
    });
  });
});

describe('wrapTextBreakAll', () => {
  const measure = (t: string) => t.length * 10;

  it('keeps text that fits on one line', () => {
    expect(wrapTextBreakAll(measure, 'PC1', 100)).toEqual(['PC1']);
  });

  it('breaks at any character when the line overflows', () => {
    expect(wrapTextBreakAll(measure, 'abcdef', 30)).toEqual(['abc', 'def']);
  });

  it('honors hard line breaks', () => {
    expect(wrapTextBreakAll(measure, 'ab\ncd', 100)).toEqual(['ab', 'cd']);
  });
});

describe('drawLabelPlacements', () => {
  it('paints a background then centered text lines', () => {
    const calls: string[] = [];
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      roundRect: vi.fn(() => calls.push('roundRect')),
      rect: vi.fn(),
      fill: vi.fn(() => calls.push('fill')),
      fillText: vi.fn((text: string) => calls.push(`text:${text}`)),
      measureText: (t: string) => ({ width: t.length * 10 }),
      font: '',
      fillStyle: '',
      textAlign: '',
      textBaseline: '',
    } as unknown as CanvasRenderingContext2D;

    const placement: LabelPlacement = {
      text: 'abcdef',
      left: 10,
      top: 20,
      width: 46, // 30px of text space after 8px padding each side → 3 chars/line
      height: 40,
      font: '700 16px sans-serif',
      color: 'rgb(17, 94, 89)',
      background: 'rgba(240, 253, 250, 0.9)',
      borderRadius: 4,
      paddingX: 8,
      lineHeight: 20,
    };
    drawLabelPlacements(ctx, [placement]);

    expect(calls).toEqual(['roundRect', 'fill', 'text:abc', 'text:def']);
    expect(ctx.fillText).toHaveBeenCalledWith('abc', 33, 30); // centered, two lines
    expect(ctx.fillText).toHaveBeenCalledWith('def', 33, 50);
  });
});
