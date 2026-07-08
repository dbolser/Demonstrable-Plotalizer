import { describe, it, expect } from 'vitest';
import {
  MISSING_T,
  buildNormalizedPositions,
  buildSlotAttribute,
  paletteToRgba,
  parseColor,
  isWebGLAvailable,
  WebGLPointRenderer,
} from '../utils/webglPoints';
import {
  CATEGORY_PALETTE,
  MISSING_SLOT,
  MISSING_COLOR,
  buildRainbowColors,
} from '../utils/colorUtils';

describe('buildNormalizedPositions', () => {
  it('normalizes linear values against the domain like d3.scaleLinear', () => {
    const values = new Float64Array([10, 15, 20]);
    const t = buildNormalizedPositions(values, 10, 20, false);
    expect(Array.from(t)).toEqual([0, 0.5, 1]);
  });

  it('maps NaN (missing) to the cull sentinel', () => {
    const values = new Float64Array([10, NaN, 20]);
    const t = buildNormalizedPositions(values, 10, 20, false);
    expect(t[1]).toBe(MISSING_T);
    expect(t[0]).toBe(0);
    expect(t[2]).toBe(1);
  });

  it('normalizes log values like d3.scaleLog', () => {
    const values = new Float64Array([1, 10, 100]);
    const t = buildNormalizedPositions(values, 1, 100, true);
    expect(t[0]).toBeCloseTo(0, 6);
    expect(t[1]).toBeCloseTo(0.5, 6);
    expect(t[2]).toBeCloseTo(1, 6);
  });

  it('culls non-positive values under a log scale (Canvas 2D dropped them via NaN coords)', () => {
    const values = new Float64Array([0, -5, NaN, 10]);
    const t = buildNormalizedPositions(values, 1, 100, true);
    expect(t[0]).toBe(MISSING_T);
    expect(t[1]).toBe(MISSING_T);
    expect(t[2]).toBe(MISSING_T);
    expect(t[3]).toBeGreaterThan(0);
  });

  it('centers points on a degenerate domain instead of dividing by zero', () => {
    expect(buildNormalizedPositions(new Float64Array([5]), 5, 5, false)[0]).toBe(0.5);
    expect(buildNormalizedPositions(new Float64Array([5]), 5, 5, true)[0]).toBe(0.5);
  });
});

describe('buildSlotAttribute', () => {
  it('maps __id slots through rowIds and buckets like the 2D paint loop', () => {
    // Full dataset of 5 rows; store holds a faceted subset [row 3, row 0].
    const slotById = new Uint16Array([2, 9, 1, 0, MISSING_SLOT]);
    const rowIds = new Int32Array([3, 0, 4]);
    const attr = buildSlotAttribute(slotById, rowIds, 10);
    expect(Array.from(attr)).toEqual([0, 2, 10]); // MISSING_SLOT -> last texel
  });

  it('sends out-of-palette and out-of-bounds ids to the missing texel', () => {
    const slotById = new Uint16Array([7]);
    const rowIds = new Int32Array([0, 99]); // 99 is out of slotById bounds
    const attr = buildSlotAttribute(slotById, rowIds, 4);
    expect(Array.from(attr)).toEqual([4, 4]); // 7 >= numSlots, undefined -> 4
  });
});

describe('paletteToRgba / parseColor', () => {
  it('parses hex colors (the category palette)', () => {
    expect(parseColor('#4e79a7')).toEqual([0x4e, 0x79, 0xa7]);
    expect(parseColor('#ccc')).toEqual([0xcc, 0xcc, 0xcc]);
  });

  it('parses rgb()/rgba() strings (d3 interpolator output)', () => {
    expect(parseColor('rgb(68, 1, 84)')).toEqual([68, 1, 84]);
    expect(parseColor('rgba(68, 1, 84, 0.5)')).toEqual([68, 1, 84]);
  });

  it('builds RGBA texels for the real category palette + missing color', () => {
    const rgba = paletteToRgba([...CATEGORY_PALETTE], MISSING_COLOR);
    expect(rgba.length).toBe((CATEGORY_PALETTE.length + 1) * 4);
    // First texel = first palette color
    expect([rgba[0], rgba[1], rgba[2], rgba[3]]).toEqual([0x4e, 0x79, 0xa7, 255]);
    // Last texel = missing color #9ca3af
    const off = CATEGORY_PALETTE.length * 4;
    expect([rgba[off], rgba[off + 1], rgba[off + 2]]).toEqual([0x9c, 0xa3, 0xaf]);
  });

  it('parses every real rainbow bucket color to a non-black texel', () => {
    const rainbow = buildRainbowColors();
    const rgba = paletteToRgba(rainbow, MISSING_COLOR);
    expect(rgba.length).toBe((rainbow.length + 1) * 4);
    let nonBlack = 0;
    for (let i = 0; i < rainbow.length; i++) {
      if (rgba[i * 4] + rgba[i * 4 + 1] + rgba[i * 4 + 2] > 0) nonBlack++;
    }
    expect(nonBlack).toBe(rainbow.length);
  });
});

describe('WebGL fallback detection', () => {
  it('reports WebGL as unavailable in jsdom (2D-mock contexts)', () => {
    // jsdom's canvas mock returns a 2D-ish object for any context type; the
    // method probe must reject it so the Canvas 2D path keeps running.
    expect(isWebGLAvailable()).toBe(false);
  });

  it('WebGLPointRenderer.create returns null (never throws) without WebGL', () => {
    expect(WebGLPointRenderer.create(150)).toBeNull();
  });

  it('accepts a real-looking WebGL context via the method probe', () => {
    const fakeCanvas = {
      getContext: (type: string) =>
        type === 'webgl' ? { createShader: () => ({}) } : null,
    } as unknown as HTMLCanvasElement;
    expect(isWebGLAvailable(() => fakeCanvas)).toBe(true);
  });
});
