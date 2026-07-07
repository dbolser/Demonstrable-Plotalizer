import { describe, it, expect } from 'vitest';
import { collectCanvasPlacements, svgToDataUrl } from '../utils/exportPng';

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
